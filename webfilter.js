"use strict";

var log4js = require('log4js');

log4js.configure({
    appenders: [
        {
            type: "file",
            filename: "webfilter.log",
			"maxLogSize": 2 * (1024 * 1024),
            "backups": 10
            //category: ['cheese', 'console']
        },
        {
            type: "console"
        }
    ]
    //,replaceConsole: true
});

var http = require("http");
var net = require("net");

var server_logger = log4js.getLogger("server");
var brequest_logger = log4js.getLogger("browser_request");
var bresponse_logger = log4js.getLogger("browser_response");
var srequest_logger = log4js.getLogger("server_request");
var sresponse_logger = log4js.getLogger("server_response");
var bsocket_logger = log4js.getLogger("browser_socket");
var ssocket_logger = log4js.getLogger("server_socket");

var config = {
    port: 19999
};

var global_request_id = 0;
var global_connection_id = 0;

var conAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 37000
    
});

var unwanted_endings = [
    "google.com",
    "googleapis.com",
    "googlesyndication.com",
    ".doubleclick.net",
    "google-analytics.com",
    "gravatar.com",
    "facebook.net",
    "facebook.com",
    "twitter.com",
    "pinterest.com",
    "adzerk.net"
    
];

function filterHost(hostport)
{
    var parts = hostport.split(":");
    var host = parts[0];
    var data = unwanted_endings;
    var n = 0, ne = data.length;
    
    do
    {
        if ( host.endsWith(data[n]) )
            return false;
    } while ( ++n < ne );
    
    return true;
}

function onSocketErrorDoNothing(){}

function prepareSocket(socket)
{
    socket.removeListener('error', onSocketErrorDoNothing);
    socket.on('error', onSocketErrorDoNothing);
}

function doRemoteRequest(request_id, options, browser_requesst, browser_response)
{
    var isConnected = false;
    var request_closed = false;
    
    var server_request = http.request(options);
    server_request
        .on('response', function (server_response)
        {
            var clength = +server_response.headers['content-length'];
            srequest_logger.info(request_id + " | response " + server_response.statusCode + " l:" + clength);
            isConnected = true;
            browser_response.writeHead(server_response.statusCode, server_response.headers);
        
            server_response.on('error', function (err)
            {
                sresponse_logger.error(request_id + " | error", err.toString(), err);
                browser_response.end();
            });
        
            server_response.on('end', function ()
            {
                sresponse_logger.info(request_id + " | end");
            });

        
            server_response.pipe(browser_response);
        })
        .on('error', function (err)
        {
            var errText = err.toString();
            var mEncoder;
        
            srequest_logger.error(request_id + " | error: " + errText);
            srequest_logger.error(err);
            if (isConnected === false)
            {
                browser_response.writeHead(500);
            }

            browser_response.end();
        })
        .on('end', function ()
        {
            srequest_logger.info(request_id + " | end");
        })
        .on('socket', function (socket)
        {
            srequest_logger.info(request_id + " | socket");
        
            prepareSocket(socket);
        })
        .on('connect', function (response, socket, head)
        {
            srequest_logger.info(request_id + " | connect(unrequested)");
        })
        .on('upgrade', function (response, socket, head)
        {
            srequest_logger.info(request_id + " | upgrade(unrequested)");
        })
        .on('continue', function ()
        {
            srequest_logger.info(request_id + " | continue(unrequested)");
        })
        .on('abort', function ()
        {
            srequest_logger.info(request_id + " | abort");
        })

        // hidden
        .on('close', function ()
        {
            srequest_logger.info(request_id + " | close");
        })
    ;

    browser_requesst.pipe(server_request);
}

function doConnect(request_id, connect_hostport, browser_request, browser_socket, first_packet)
{
    var isConnected = false;
    var tmp_parts = connect_hostport.split(":");
    var connect_hostname = tmp_parts[0];
    var connect_port = tmp_parts.length > 1 ? parseInt(tmp_parts[1]) : 443;

    var dest_socket = new net.Socket();

    dest_socket.connect(connect_port, connect_hostname);

    dest_socket
        .on('lookup', function(err, name, type)
        {
            ssocket_logger.info(request_id + " @ lookup", name);
        })
        .on('connect', function ()
        {
            ssocket_logger.info(request_id + " @ connect");

            isConnected = true;
            browser_socket.write("HTTP/" + browser_request.httpVersion + " 200 Connection established\r\n\r\n");
            
            if ( first_packet.length > 0 )
                dest_socket.write(first_packet);
            
            dest_socket.pipe(browser_socket);
            browser_socket.pipe(dest_socket);

        })
        .on('end', function ()
        {
            ssocket_logger.info(request_id + " @ end");
        })
        .on('error', function (err)
        {
            ssocket_logger.error(request_id + " @ error", err.toString(), err);
            
            if ( isConnected === false )
            {
                browser_socket.end("HTTP/" + browser_request.httpVersion + " 500 Not Found\r\n\r\n");
            }
            else
            {
                ssocket_logger.error(request_id + " @ error while already connected");
                browser_socket.end();
            }

        })
        .on('drain', function ()
        {
            ssocket_logger.info(request_id + " @ drain");
        })
        .on('timeout', function ()
        {
            ssocket_logger.info(request_id + " @ timeout");
        })
        .on('close', function ()
        {
            ssocket_logger.info(request_id + " @ close");
        });

    browser_request.on('error', function (err) {
        brequest_logger.error(request_id + " @ error", err.toString(), err);
        dest_socket.end();
    });
    
    browser_socket.on('error', function(err)
    {
        bsocket_logger.error(request_id + " @ error", err.toString(), err);
        dest_socket.end();
    });
}

var server = http.createServer();
server

    // 5 events from http.Server

    .on('request', function (browser_request, browser_response)
    {
        var request_id = ++global_request_id;
        var client_id = browser_request.socket.xconnection_id;
        
        if ( ! filterHost(browser_request.headers.host) )
        {
            server_logger.info(client_id + "," + request_id + " | request DENY", browser_request.headers.host);
            browser_response.writeHead(500);
            browser_response.end();
            return;
        }
        
        server_logger.info(client_id + "," + request_id + " | request ACCEPT", browser_request.method, browser_request.url);

        browser_request
            .on('close', function()
            {
                brequest_logger.info(request_id + " | close");
            })
//            .on('data', function(chunk)
//            {
//                logger.info("request request data", chunk.toString());
//            })
            .on('end', function()
            {
                brequest_logger.info(request_id + " | end");
            })
            .on('error', function(err)
            {
                brequest_logger.error(request_id + " | error", err.toString(), err);
            });

        browser_response
            .on('close', function()
            {
                bresponse_logger.info(request_id + " | close");
            })
//            .on('finish', function()
//            {
////                logger.info("request response finish");
//            })
            .on('socket', function()
            {
                bresponse_logger.info(request_id + " | socket *** HIDDEN ***");
            })
            .on('error', function(err)
            {
                bresponse_logger.error(request_id + " | error", err.toString(), err);
            })
//            .on('prefinish', function()
//            {
////                logger.info("request response prefinish");
//            })
//            .on('drain', function()
//            {
////                logger.info("request response drain");
//            });
        
        doRemoteRequest(request_id, {
            hostname: browser_request.headers.host,
            path: browser_request.url,
            method: browser_request.method,
            headers: browser_request.headers
            ,agent: conAgent
        }, browser_request, browser_response);
    })
    .on('checkContinue', function(request, response)
    {
        server_logger.info("checkContinue");
    })
    .on('connect', function(request, socket, head)
    {
        var request_id = ++global_request_id;
        
        if ( ! filterHost(request.headers.host) )
        {
            server_logger.info(request_id + " @ connect DENY", request.url);
            socket.end("HTTP/" + request.httpVersion + " 405 Method Not Allowed\r\n\r\n");
            return;
        }
        
        server_logger.info(request_id + " @ connect ACCEPT", request.url);
        doConnect(request_id, request.headers.host, request, socket, head);
        
    })
    .on('upgrade', function(request, socket, head)
    {
        server_logger.info("upgrade " + request.url);
        socket.end("HTTP/" + request.httpVersion + " 405 Method Not Allowed\r\n\r\n");
    })
    .on('clientError', function(err, socket)
    {
        server_logger.info("clientError", err.toString(), err);
    })

    // 4 events from net.Server

    .on('connection', function(socket)
    {
        var connection_id = ++global_connection_id;
        socket.xconnection_id = connection_id;

        server_logger.info("connection "+connection_id+" from " + socket.remoteAddress + ":" + socket.remotePort);
        socket.on('error', function (err)
        {
            server_logger.error("Fucking socket "+connection_id+" had error, " + socket.remoteAddress + ":" + socket.remotePort, err);
        });
    })
    .on('close', function()
    {
        server_logger.info("server close");
    })
    .on('listening', function()
    {
        server_logger.info("server listening on " + config.port);
    })
    .on('error', function(err)
    {
        server_logger.info("server error", err.toString(), err);
    })

    .listen(config.port);

