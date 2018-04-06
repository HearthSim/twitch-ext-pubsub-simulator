#!/usr/bin/env node
const yargs = require("yargs");
const fs = require("fs");
const path = require("path");
const Promise = require("promise");
const request = require("request");
const { Buffer } = require("buffer");
const JWT = require("jsonwebtoken");
const StringDecoder = require("string_decoder").StringDecoder;

const argv = yargs
	.usage("Usage: $0 [options]")
	.default("interval", 1000)
	.describe("i", "How many ms to wait inbetween messages")
	.alias("i", "interval")
	.demand("f")
	.describe("f", "A file containing messages")
	.alias("f", "file")
	.help("h")
	.alias("h", "help")
	.boolean("v")
	.alias("v", "verbose")
	.alias("r", "repeat")
	.boolean("r")
	.describe("r", "Whether to endlessly repeat the data")
	.describe("channel", "The channel to send the data to")
	.default("channel", "173220974")
	.describe("owner", "The extension owner")
	.default("owner", "173220974")
	.demand("owner")
	.describe("extension", "The extension client id")
	.describe("secret", "The extension secret, base64 encoded")
	.demand("secret")
	.argv;

// these must all be strings (otherwise the JWT will be invalid)
const extensionOwner = argv.owner;
const extensionClientId = argv.extension;
const base64Secret = argv.secret;
const targetChannel = "" + argv.channel;
const messageInterval = argv.interval;
const sourceFile = argv.file;

console.log(`Configured extension ${extensionClientId} with owner ${extensionOwner}`);
console.log(`Sending to channel ${targetChannel}`);

// build jwt
const makeJWT = function() {
	const secret = Buffer.from(base64Secret, "base64");
	const jwt_payload = {
		"exp": Math.floor(new Date().getTime() / 1000) + 1 * 60,
		"user_id": extensionOwner,
		"role": "external",
		"channel_id": targetChannel,
		"pubsub_perms": {
			"send": [
				"*",
			],
		},
	};
	return JWT.sign(jwt_payload, secret);
};

// read and send messages
const promise = new Promise((resolve, reject) => {
	fs.readFile(path.join(__dirname, sourceFile), "utf8", (err, data) => {
		if (err) {
			reject(err);
			return;
		}
		resolve(data);
	});
})
.then((data) => JSON.parse(data))
.then((array) => new Promise((resolve, reject) => {
	const interval = setInterval(() => {
		const elem = array.shift();
		if(argv.repeat) {
			array.push(elem);
		}
		if (!elem) {
			clearInterval(interval);
			resolve();
			return;
		}
		new Promise((resolve, reject) => {
			// build the payload
			const payload = {
				content_type: "application/json",
				message: JSON.stringify(elem),
				targets: [
					"broadcast",
				],
			};
			const out = JSON.stringify(payload);

			const decoder = new StringDecoder("utf8");

			if (argv.v) {
				console.log(`Sending payload ${out}`);
			}
			// do the request
			request({
				uri: `https://api.twitch.tv/extensions/message/${targetChannel}`,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${makeJWT()}`,
					"Client-Id": extensionClientId,
					"Content-Type": "application/json; charset=utf-8",
					"Content-Length": out.length,
				},
				gzip: true,
				body: out,
			}, (error, res, body) => {
				if (error) {
					reject(error);
					return;
				}
			})
			.on("response", (res) => {
				console.log(`statusCode: ${res.statusCode}`);
				if (argv.v) {
					console.log(res.headers);
				}
			})
			.on("data", (chunk) => {
				console.log(decoder.write(chunk));
			});
		})
		.catch((error) => {
			console.error(error);
		});
	}, messageInterval);
}))
.catch((err) => console.error(err))
.then(() => console.log("Done"));
