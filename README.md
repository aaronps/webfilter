# webfilter - Filter unwanted domains

**note** this is more an example than a tool, it is usable but there is a bug where in some cases a server will send a redirect which will be wrong, I fixed this problem on another project but currently don't have the time to fix here.

This is a simple filter, you set your browser to use an http/https proxy on localhost:19999 (change the port on the code), then this program will forward the requests, except the ones where the domain part ends with any of the forbidden array "unwanted_endings".

The idea of this minitool is that in some countries on the world is faster to drop the connection yourself than waiting the isp to timeout for some domains.

## Installing

This application requires log4js, install with ```node install```.

## Running

```
node webfilter.js
```
