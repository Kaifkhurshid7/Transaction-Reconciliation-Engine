'use strict';

const morgan = require('morgan');
const logger = require('../utils/logger');

/* Pipe morgan tokens into winston so all logs go through one transport */
const stream = {
  write: (message) => logger.http(message.trim()),
};

const requestLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  { stream },
);

module.exports = requestLogger;
