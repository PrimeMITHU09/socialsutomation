const requestHandler = require('../src/server.js');
const http = require('http');

module.exports = async (req, res) => {
  // Vercel's req.url is just the path, reconstruct full URL like Node's http
  const host = req.headers.host || 'localhost';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const fullUrl = `${protocol}://${host}${req.url}`;
  
  // Create a mock Node.js http.IncomingMessage-like object
  const mockReq = Object.create(http.IncomingMessage.prototype);
  Object.assign(mockReq, req);
  mockReq.url = fullUrl;
  mockReq.httpVersion = '1.1';
  mockReq.httpVersionMajor = 1;
  mockReq.httpVersionMinor = 1;
  mockReq.complete = true;
  mockReq.connection = { remoteAddress: req.headers['x-forwarded-for'] || '127.0.0.1' };
  mockReq.socket = mockReq.connection;

  // Create a mock ServerResponse that works with Vercel's res
  const mockRes = Object.create(http.ServerResponse.prototype);
  Object.assign(mockRes, res);
  
  // Ensure writeHead works
  const originalWriteHead = mockRes.writeHead;
  mockRes.writeHead = function(statusCode, statusMessage, headers) {
    if (typeof statusMessage === 'object') {
      headers = statusMessage;
      statusMessage = undefined;
    }
    mockRes.statusCode = statusCode;
    if (headers) {
      Object.entries(headers).forEach(([k, v]) => mockRes.setHeader(k, v));
    }
    if (originalWriteHead) {
      return originalWriteHead.call(this, statusCode, statusMessage, headers);
    }
    return mockRes;
  };

  // Ensure end works
  const originalEnd = mockRes.end;
  mockRes.end = function(chunk, encoding) {
    return originalEnd.call(this, chunk, encoding);
  };

  // Add missing methods that server.js might use
  mockRes.setHeader = mockRes.setHeader || ((k, v) => {});
  mockRes.getHeader = mockRes.getHeader || (() => {});
  mockRes.removeHeader = mockRes.removeHeader || (() => {});
  mockRes.hasHeader = mockRes.hasHeader || (() => false);
  mockRes.headersSent = false;
  mockRes.statusCode = 200;

  return requestHandler(mockReq, mockRes);
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};