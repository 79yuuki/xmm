const faucet = "https://faucet.altnet.rippletest.net/accounts";
const testnet = "wss://s.altnet.rippletest.net:51233";
const root = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const syntax = /^(|([^:@]+)(|:([^:@]+))@)([^@]+)$/;

class XMMarg {
	constructor(xmm, obj) {
		this.shorten = xmm.shorten.bind(xmm);
		this.toabs = xmm.toabs.bind(xmm);
		this.wallets = xmm.wallets;
		this.assets = xmm.assets;

		this.input = JSON.stringify(obj);
		this.type = "undefined";

		if ("string" == typeof obj)
			obj = this.parse(obj);

		if (!obj)
			return;

		this.type = obj.type;
		this.value = obj.value;
		this.asset = obj.asset;
		this.wallet = obj.wallet;
	}

	get key() {
		let id = this.shorten(this.wallet);

		id = this.wallets[id];
		if (id)
			return id.secret;
	}

	get amount() {
		const obj = {};
		const asset = this.asset;
		let issuer;

		if ("value" != this.type)
			return;

		obj.value = this.value.toString();
		obj.currency = asset.code;

		issuer = asset.issuer;
		if (issuer)
			obj.counterparty = issuer;

		return obj;
	}

	toasset(str) {
		const obj = {};
		let asset, issuer;

		if ("string" != typeof str)
			return;

		str = str.split(".");
		asset = str.shift();
		issuer = str.shift();

		if ("XRP" == asset) {
			if (issuer)
				return;

			obj.code = asset;
			return obj;
		}

		if (issuer) {
			issuer = this.toabs(issuer);
			if (!issuer)
				return;

			obj.code = asset;
			obj.issuer = issuer;
			return obj;
		}

		return this.assets[asset];
	}

	get human() {
		let value, asset, issuer, wallet;
		let str = "";

		switch (this.type) {
		case "value":
			value = this.value.toString();
			str = ":" + value;
		case "asset":
			asset = this.asset;
			issuer = asset.issuer;
			asset = asset.code;
			if (issuer) {
				issuer = this.shorten(issuer);
				asset = asset + "." + issuer;
				asset = this.shorten(asset);
			}
			str = asset + str + "@";
		case "wallet":
			wallet = this.wallet;
			wallet = this.shorten(wallet);
			str = str + wallet;
			return str;
		}
	}

	parse(str) {
		const tokens = syntax.exec(str);
		let asset, value, wallet, type;

		if (!tokens)
			return;

		asset = tokens[2];
		value = tokens[4];
		wallet = tokens[5];

		if (value)
			type = "value";
		else if (asset)
			type = "asset";
		else if (wallet)
			type = "wallet";
		else
			return;

		switch (type) {
		case "value":
			value = parseFloat(value);
			if (!isFinite(value))
				return;
		case "asset":
			asset = this.toasset(asset);
			if (!asset)
				return;
		case "wallet":
			wallet = this.toabs(wallet);
			if (!wallet)
				return;
		}

		return {
			type: type,
			value: value,
			asset: asset,
			wallet: wallet
		};
	}

	expect(type) {
		if (type != this.type)
			return `${this.input} is not ${type}`;
	}
}

class XMM {
	constructor(opts) {
		this.ledger = opts.ledger;
		this.api = opts.api;
		this.wallets = opts.wallets;
		this.assets = opts.assets;
		this.dict = {};
		this.expand();
		this.reverse();
	}

	expand() {
		const wallets = this.wallets;
		const assets = this.assets;

		for (let alias in wallets) {
			const entry = wallets[alias];

			if ("string" == typeof entry) {
				const obj = {
					address: entry
				};

				wallets[alias] = obj;
			}
		}

		for (let alias in assets) {
			const entry = assets[alias];

			if ("string" == typeof entry) {
				const pair = entry.split(".");
				const code = pair.shift();
				const issuer = pair.shift();
				const obj = {
					code: code,
					issuer: issuer
				};

				assets[alias] = obj;
			}
		}

		for (let alias in assets) {
			const entry = assets[alias];

			entry.issuer = this.toabs(entry.issuer);
		}
	}

	reverse() {
		const dict = this.dict;
		const wallets = this.wallets;
		const assets = this.assets;

		for (let alias in wallets)
			dict[wallets[alias].address] = alias;

		for (let alias in assets) {
			const asset = assets[alias];
			let issuer = asset.issuer;
			let key = asset.code;

			if (issuer) {
				issuer = this.shorten(issuer);
				key = key.concat(".", issuer);
			}

			dict[key] = alias;
		}
	}

	shorten(line) {
		const alias = this.dict[line];

		if (alias)
			return alias;

		return line;
	}

	toabs(wallet) {
		if (/^r[A-Za-z0-9]{25,}$/.test(wallet))
			return wallet;

		wallet = this.wallets[wallet];
		if (wallet)
			return wallet.address;
	}

	tobal(list, me) {
		const iou = {};

		list = list.filter(line => {
			const value = parseFloat(line.value);

			if (value > 0)
				return true;

			if (value < 0) {
				const code = line.currency;

				if (!iou[code])
					iou[code] = 0;

				iou[code] += value;
			}

			return false;
		});

		for (let code in iou) {
			const value = iou[code].toString();

			list.push({
				currency: code,
				counterparty: me,
				value: value
			});
		}

		return list.map(line => new XMMarg(this, {
			type: "value",
			value: parseFloat(line.value),
			asset: {
				code: line.currency,
				issuer: line.counterparty
			},
			wallet: me
		}));
	}

	balance(wallet, ledger) {
		const arg = this.parse(wallet);
		const reason = arg.expect("wallet");

		if (!ledger)
			ledger = this.ledger;

		return new Promise((resolve, reject) => {
			let me;

			if (reason) {
				reject(reason);
				return;
			}

			me = arg.wallet;

			this.api.getBalances(me, {
				ledgerVersion: ledger
			}).then(list => {
				resolve(this.tobal(list, me));
			}).catch(reject);
		});
	}

	parse(arg) {
		return new XMMarg(this, arg);
	}

	send(src, dst) {
		return new Promise((resolve, reject) => {
			let reason, me;

			src = this.parse(src);
			reason = src.expect("value");
			if (reason) {
				reject(reason);
				return;
			}

			dst = this.parse(dst);
			reason = dst.expect("value");
			if (reason) {
				reject(reason);
				return;
			}

			me = src.wallet;

			this.api.preparePayment(me, {
				source: {
					address: me,
					maxAmount: src.amount
				},
				destination: {
					address: dst.wallet,
					amount: dst.amount
				}
			}).then(tx => {
				tx = this.sign(tx, src);
				resolve(tx);
			}).catch(reject);
		});
	}

	sign(tx, arg) {
		const json = tx.txJSON;

		tx = this.api.sign(json, arg.key);

		return {
			blob: tx.signedTransaction,
			hash: tx.id,
			json: json
		};
	}
}

exports.connect = config => new Promise(resolve => {
	const ripple = require("ripple-lib");
	const api = new ripple.RippleAPI({
		feeCushion: config.cushion,
		timeout: config.timeout * 1e3,
		server: config.server
	});
	let count = config.count > 0 ? config.count : 1;

	function tick(ledger)
	{
		if (count > 0) {
			--count;
			api.once("ledger", tick);
		} else {
			const xmm = new XMM({
				ledger: ledger.ledgerVersion,
				api: api,
				wallets: config.wallets,
				assets: config.assets
			});

			resolve(xmm);
		}
	}

	tick();
	api.connect();
});

function generate()
{
	const ripple = require("ripple-lib");
	const api = new ripple.RippleAPI();

	return api.generateAddress();
}

exports.generate = generate;

exports.testnet = opts => new Promise((resolve, reject) => {
	require("request").post({
		url: faucet,
		json: true
	}, (error, response, body) => {
		let code;

		if (error) {
			reject(error);
			return;
		}

		code = response.statusCode;
		if (201 != code) {
			reject(body + code.toString());
			return;
		}

		resolve({
			wallets: {
				bank: body.account,
				fund: generate(),
				root: root
			},
			assets: {
				XMM: "XMM.fund",
				USD: "USD.bank",
				BTC: "BTC.bank"
			},
			server: testnet
		});
	});
});
