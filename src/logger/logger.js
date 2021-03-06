/** @flow */
import winston from 'winston';
import path from 'path';
import { GLOBAL_LOGS } from '../constants';
import { Analytics } from '../analytics/analytics';

// Store the extensionsLoggers to prevent create more than one logger for the same extension
// in case the extension developer use api.logger more than once
const extensionsLoggers = new Map();

export const baseFileTransportOpts = {
  filename: path.join(GLOBAL_LOGS, 'debug.log'),
  json: false,
  // Make it debug level also in production until the product will be more stable. in the future this should be changed to error
  level: process.env.NODE_ENV === 'production' ? 'debug' : 'debug',
  maxsize: 10 * 1024 * 1024, // 10MB
  maxFiles: 10,
  colorize: true,
  prettyPrint: true,
  // If true, log files will be rolled based on maxsize and maxfiles, but in ascending order.
  // The filename will always have the most recent log lines. The larger the appended number, the older the log file
  tailable: true
};

const exceptionsFileTransportOpts = Object.assign({}, baseFileTransportOpts, {
  filename: path.join(GLOBAL_LOGS, 'exceptions.log')
});

const logger = new winston.Logger({
  transports: [new winston.transports.File(baseFileTransportOpts)],
  exceptionHandlers: [new winston.transports.File(exceptionsFileTransportOpts)],
  exitOnError: false
});

/**
 * Create a logger instance for extension
 * The extension name will be added as label so it will appear in the begining of each log line
 * The logger is cached for each extension so there is no problem to use getLogger few times for the same extension
 * @param {string} extensionName
 */
export const createExtensionLogger = (extensionName: string) => {
  // Getting logger from cache
  const existingLogger = extensionsLoggers.get(extensionName);

  if (existingLogger) {
    return existingLogger;
  }
  const extensionFileTransportOpts = Object.assign({}, baseFileTransportOpts, {
    filename: path.join(GLOBAL_LOGS, 'extensions.log'),
    label: extensionName
  });
  const extLogger = new winston.Logger({
    transports: [new winston.transports.File(extensionFileTransportOpts)],
    exceptionHandlers: [new winston.transports.File(extensionFileTransportOpts)],
    exitOnError: false
  });
  extensionsLoggers.set(extensionName, extLogger);
  return extLogger;
};

// @credit Kegsay from https://github.com/winstonjs/winston/issues/228
// it solves an issue when exiting the code explicitly and the log file is not written
logger.exitAfterFlush = async (code: number = 0, commandName: string) => {
  await Analytics.sendData();
  let level;
  let msg;
  if (code === 0) {
    level = 'info';
    msg = `[*] the command ${commandName} has been completed successfully`;
  } else {
    level = 'error';
    msg = `[*] the command ${commandName} has been terminated with an error code ${code}`;
  }
  logger.log(level, msg, () => {
    let numFlushes = 0;
    let numFlushed = 0;
    Object.keys(logger.transports).forEach((k) => {
      if (logger.transports[k]._stream) {
        numFlushes += 1;
        logger.transports[k]._stream.once('finish', () => {
          numFlushed += 1;
          if (numFlushes === numFlushed) {
            process.exit(code);
          }
        });
        logger.transports[k]._stream.end();
      }
    });
    if (numFlushes === 0) {
      process.exit(code);
    }
  });
};

logger.debugAndAddBreadCrumb = (category: string, message: string) => {
  logger.debug(`${category}, ${message}`);
  Analytics.addBreadCrumb(category, message);
};

if (process.env.BIT_LOG) {
  const level = process.env.BIT_LOG;
  logger.add(winston.transports.Console, { level });
  logger.cli();
}

export default logger;
