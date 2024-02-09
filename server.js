// include dependencies
const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const proxy = require('express-http-proxy');

const app = express();

const clientAppPath = path.join(path.join(__dirname, "./client/dist/")); 
app.use(express.static(clientAppPath));

app.get('/foo/bar', (req, res) => {
  console.log("Serving React App");
  console.log(req.headers)
});

app.use('/api', createProxyMiddleware({
    changeOrigin: true,
    headers: {
      connection: "keep-alive"
    },
    target: "http://diaassetsapi.com/",
    onProxyReq: proxyReq => {
        proxyReq.setHeader('clientSecret', '12345674861287412');
        console.log(proxyReq);
    },
  }));
app.listen(3000);