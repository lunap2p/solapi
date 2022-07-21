require('dotenv').config()
const Redis = require("ioredis")
const redis = new Redis()

const M = require('accurate')
const axios = require('axios').default

const fs = require('mz/fs')
const Map = require('./map')
const flat = require('./flat')
const bip39 = require('bip39')
const bip32 = require('bip32')
const nacl = require('tweetnacl')
const { derivePath } = require('ed25519-hd-key')
const R = require('ramda')
const BigNumber = require('bignumber.js')
BigNumber.prototype.isBigNumber = true

const token = require('@solana/spl-token')
const { Connection, clusterApiUrl, Keypair, Account, PublicKey, sendAndConfirmTransaction, sendAndConfirmRawTransaction, Transaction, SystemProgram } =  require("@solana/web3.js")

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')

const log = (...ls) => {
    console.log(...ls)
}

const rx = (num, d) => {
    const [ nat, dec ] = num.toString().split('.')
    if (!dec) return Number(nat)
    return Number(nat + '.' + dec.slice(0, d))
}

const restore = async (input) => {
    var secretKeyString
    try {
        secretKeyString = await fs.readFile(input, {encoding: 'utf8'})
    } catch (err) {
        secretKeyString = Array.isArray(input) ? `[${input}]` : input
    }

    const secretKey = Uint8Array.from(JSON.parse(secretKeyString))
    const wallet = Keypair.fromSecretKey(secretKey)
    return {
        wallet: wallet,
        address: wallet.publicKey.toBase58(),
        private: secretKey
    }
}

const create = (mnemonic, derived = 0) => {
    const derivedSeed = derivePath(`m/44'/501'/${derived}'/0'`, bip39.mnemonicToSeedSync(mnemonic)).key
    const secretKey = nacl.sign.keyPair.fromSeed(derivedSeed).secretKey
    const wallet = Keypair.fromSecretKey(secretKey)
    return {
        wallet: wallet,
        address: wallet.publicKey.toBase58(),
        private: secretKey
    }
}

const isAddrs = (_addrs) => {
    var addrs = _addrs
    if (typeof addrs === 'string' || addrs instanceof String) { addrs = [addrs] }
    for (let addr of addrs) {
        try {
            new PublicKey(addr)
        } catch (e) {
            return false
        }
    }
    return true
}

const solBals2 = async (addrs, avails = []) => {
    var bals = [], cc = new Map()
    for (var i = 0; i < addrs.length; i++) {
        var avail = avails[i] === undefined ? 0 : avails[i]
        if ( !cc.nget(addrs[i], 'balance') ){
            const amount = await connection.getBalance(new PublicKey(addrs[i]))
            bals.push({
                ui: rx(amount / 1e9, 9),
                cal: amount
            })
            cc.nincr(rx(amount / 1e9, 9), addrs[i], 'balance')
            cc.nincr(avail, addrs[i], 'available')
        } else {
            // const amount = cc.nget(addrs[i], 'balance')
            // bals.push({
            //     ui: amount,
            //     cal: rx(amount * 1e9, 0)
            // })
            bals.push({
                ui: 0,
                cal: 0
            })
            cc.nincr(avail, addrs[i], 'available')
        }
        if ( cc.nget(addrs[i], 'available') > cc.nget(addrs[i], 'balance') ) return false
    }
    return bals
}

const solBals = async (addrs, avails = []) => {
    const aggs = await batchRead(addrs)
    
    var bals = [], cc = new Map()
    for (var i = 0; i < addrs.length; i++) {
        var avail = avails[i] === undefined ? 0 : avails[i]
        if ( !cc.nget(addrs[i], 'balance') ){
            bals.push(aggs[i])
            cc.nincr(rx(aggs[i] / 1e9, 9), addrs[i], 'balance')
            cc.nincr(avail, addrs[i], 'available')
        } else {
            bals.push(new BigNumber(0))
            cc.nincr(avail, addrs[i], 'available')
        }
        if ( cc.nget(addrs[i], 'available') > cc.nget(addrs[i], 'balance') ) return false
    }
    return bals
}

const splBals2 = async (addrs, mints, avails = []) => {
    var bals = [], cc = new Map(), multiMint = Array.isArray(mints)
    for (var i = 0; i < addrs.length; i++) {
        var _mint = multiMint ? mints[i] : mints
        var avail = avails[i] === undefined ? 0 : avails[i]
        if ( !cc.nget(addrs[i], _mint, 'balance') ){
            var ata = await token.getAssociatedTokenAddress(new PublicKey(_mint), new PublicKey(addrs[i]))
            try {
                var { value } = await connection.getTokenAccountBalance(ata)
                bals.push({
                    ui: value.uiAmount,
                    cal: Number(value.amount)
                })

                cc.nincr(value.uiAmount, addrs[i], _mint, 'balance')
                cc.nincr(Number(value.amount), addrs[i], _mint, 'cal')
                cc.nincr(avail, addrs[i], _mint, 'available')
            } catch (err){
                // log(err.toString())
                bals.push({
                    ui: 0,
                    cal: 0
                })
                cc.nincr(0, addrs[i], _mint, 'balance')
                cc.nincr(0, addrs[i], _mint, 'cal')
                cc.nincr(avail, addrs[i], _mint, 'available')
            }
        } else {
            // bals.push({
            //     ui: cc.nget(addrs[i], _mint, 'balance'),
            //     cal: cc.nget(addrs[i], _mint, 'cal')
            // })
            bals.push({
                ui: 0,
                cal: 0
            })
            cc.nincr(avail, addrs[i], _mint, 'available')
        }
        if ( cc.nget(addrs[i], _mint, 'available') > cc.nget(addrs[i], _mint, 'balance') ) return false
    }
    return bals
}

const splBals = async (addrs, mints, avails = []) => {
    const aggs = await batchRead( await getAtas(addrs, mints), [32, 32, 8, 36, 1, 12, 8, 36], [{ index: 2, key: 'amount', type: 'u64' }])
    
    var bals = [], cc = new Map(), multiMint = Array.isArray(mints)
    for (var i = 0; i < addrs.length; i++) {
        var _mint = multiMint ? mints[i] : mints
        var avail = avails[i] === undefined ? 0 : avails[i]
        if ( !cc.nget(addrs[i], _mint, 'balance') ){
            bals.push(aggs[i].amount)
            cc.nincr(rx(aggs[i].amount / 1e9, 9), addrs[i], _mint, 'balance')
            cc.nincr(avail, addrs[i], _mint, 'available')
        } else {
            bals.push(new BigNumber(0))
            cc.nincr(avail, addrs[i], _mint, 'available')
        }

        if ( cc.nget(addrs[i], _mint, 'available') > cc.nget(addrs[i], _mint, 'balance') ) return false
    }
    return bals
}

const createRaw = async (transactions, signers, fees) => {
    const blockhash = (await connection.getLatestBlockhash("finalized")).blockhash
    transactions.recentBlockhash = blockhash
    
    transactions.sign(...signers)
    try {
        const raw = transactions.serialize()
        const size = Buffer.byteLength(raw) //1232
        if ( size > 1232 ) return null
        return {
            raw: raw,
            fees: fees,
            size: size
        }
        // return await sendAndConfirmRawTransaction(connection, raw)
    } catch (e) {
        return null
    }
}

const feeCal = async (payerAddr, _addrs, _receives, _mints) => {
    var fees = 0, cc = new Map()
    for (var i = 0; i < _receives.length; i++){
        if (_mints !== undefined){
            for (var j = 0; j < _receives[i].length; j++){
                if (!cc.has(_receives[i][j])){
                    var ata = await token.getAssociatedTokenAddress(new PublicKey(_mints[i][j]), new PublicKey(_receives[i][j]))
                    try {
                        const account = await token.getAccount(connection, ata)
                        cc.set(_receives[i][j], true)
                    } catch (error){
                        if (error instanceof token.TokenAccountNotFoundError || error instanceof token.TokenInvalidAccountOwnerError) {
                            fees += 0.00203928
                            cc.set(_receives[i][j], true)
                        } else {
                            throw error
                        }
                    }   
                }
            }
        }
        var signers = [payerAddr].concat(_addrs[i])
        fees += (new Set(signers).size) * 0.000005
        
    }
    return rx(fees, 8)
}

const solRaw = async (payer, _wallets, _receives, _values, _addrs) => {
    const payerAddr = payer.publicKey.toBase58()
    const signers = [payer], cc = new Map([[payerAddr, true]])
    const transactions = new Transaction({
        feePayer: payer.publicKey
    })

    for (var i = 0; i < _wallets.length; i++){
        if ( _values[i] > 0 ){
            transactions.add(
                SystemProgram.transfer({ 
                    fromPubkey: _wallets[i].publicKey, 
                    toPubkey: new PublicKey(_receives[i]),
                    // lamports: rx(_values[i] * 1e9, 0)
                    lamports: _values[i].isBigNumber ? _values[i] : rx(_values[i] * 1e9, 0)
                })
            )
            if (!cc.has(_addrs[i])){
                signers.push(_wallets[i])
                cc.set(_addrs[i], true)
            } 
        }
    }
    if (transactions.instructions.length == 0) return null

    const fees = rx(signers.length * 0.000005, 6)

    return await createRaw(transactions, signers, fees)
}

const solSend = async (wallets, receives, opts = {}) => {
    if (!isAddrs(receives)) return null

    var { values, payer, chunk, ts, check } = opts
    if (check === undefined) { check = true }
    if (ts === undefined) { ts = 5000 }
    if (chunk === undefined) { chunk = 21 }
    if (payer === undefined){ payer = wallets[0] || wallets }
    const payerAddr = payer.publicKey.toBase58()
    
    if (values === undefined){
        const wl = Array.isArray(wallets) ? wallets : [wallets]
        const _addrx = wl.map(wallet => wallet.publicKey.toBase58())
        if (_addrx.includes(payerAddr)) return null
        // const bals = await solBals(_addrx)
        // values = bals.map(bal => bal.ui)
        values = await solBals(_addrx)
        check = false
    }

    const fp = flat.sol(wallets, receives, values, chunk)
    if (fp === null) return null

    const { _wallets, _receives, _values, _addrs, addrx, valuex } = fp

    if (check){
        const xFees = await feeCal(payerAddr, _addrs, _receives)
        const bals = await solBals([payerAddr].concat(addrx), [xFees].concat(valuex))
        if (!bals) return null
    }

    var txs = []
    for (let i = 0; i < _wallets.length; i++) {
        setTimeout(async () => {
            const sr = await solRaw(payer, _wallets[i], _receives[i], _values[i], _addrs[i])
            if (sr === null) return null
            const { raw, fees } = sr 
            const tx = await sendAndConfirmRawTransaction(connection, raw)
            txs.push(tx)
            log(i, tx)
        }, ts * i)
    }
    return txs
}

const getOrCreateAta = async (payer, mint, owner, commitment = 'confirmed') => {
    const associatedToken = await token.getAssociatedTokenAddress(mint, owner)
    let account
    try {
        account = await token.getAccount(connection, associatedToken, commitment)
    } catch (error) {
        if (error instanceof token.TokenAccountNotFoundError || error instanceof token.TokenInvalidAccountOwnerError) {
            try {
                return {
                    to: associatedToken,
                    inst: token.createAssociatedTokenAccountInstruction(
                        payer.publicKey,
                        associatedToken,
                        owner,
                        mint,
                    )
                }
            } catch (err) {
                throw err
            }

            account = await getAccount(connection, associatedToken, commitment)
        } else {
            throw error
        }
    }
    if (!account.mint.equals(mint)) throw new token.TokenInvalidMintError()
    if (!account.owner.equals(owner)) throw new token.TokenInvalidOwnerError()

    return {
        to: account,
        inst: null
    }
}

const splRaw = async (payer, _wallets, _receives, _mints, _values, _addrs, cx) => {
    var fees = 0
    const payerAddr = payer.publicKey.toBase58()
    const signers = [payer], cc = new Map([[payerAddr, true]])
    const transactions = new Transaction({
        feePayer: payer.publicKey
    })
    for (var i = 0; i < _wallets.length; i++){
        if ( _values[i] > 0 ){
            const from = await token.getAssociatedTokenAddress(new PublicKey(_mints[i]), _wallets[i].publicKey)
            const { to, inst } = await getOrCreateAta(payer, new PublicKey(_mints[i]), new PublicKey(_receives[i]))
            if ( inst !== null && !cx.has(_receives[i])){
                transactions.add(inst)
                cx.set(_receives[i], true)
                log('A')
                fees += 0.00203928
            }
            transactions.add(
                token.createTransferInstruction(
                    from,
                    to.address || to,
                    _wallets[i].publicKey,
                    // rx(_values[i] * 1e9, 0),
                    _values[i].isBigNumber ? _values[i] : rx(_values[i] * 1e9, 0),
                ),
            )
            if (!cc.has(_addrs[i])){
                signers.push(_wallets[i])
                cc.set(_addrs[i], true)
            }
        }
    }
    if (transactions.instructions.length == 0) return null
    fees += rx(signers.length * 0.000005, 6)
    fees = rx(fees, 8)

    return await createRaw(transactions, signers, fees)
}

const splSend = async (wallets, receives, mints, opts = {}) => {
    if (!isAddrs(receives)) return null

    var { values, payer, chunk, checkFees, ts } = opts, check = true
    if (checkFees === undefined) { checkFees = false }
    if (ts === undefined) { ts = 5000 }
    if (chunk === undefined) { chunk = 5 }
    if (payer === undefined){ payer = wallets[0] || wallets }
    const payerAddr = payer.publicKey.toBase58()
    
    if (values === undefined){
        const wl = Array.isArray(wallets) ? wallets : [wallets]
        var _addrx = wl.map(wallet => wallet.publicKey.toBase58())

        if (_addrx.length == 1 && Array.isArray(mints) && mints.length > 1){
            _addrx = Array(mints.length).fill(_addrx[0])
        }
        // const bals = await splBals(_addrx, mints)
        // values = bals.map(bal => bal.ui)
        values = await splBals(_addrx, mints)
        check = false
    }

    const fp = flat.spl(wallets, receives, mints, values, chunk)
    if (fp === null) return null

    const { _wallets, _receives, _mints, _values, _addrs, addrx, mintx, valuex } = fp

    if (check){
        const bals = await splBals(addrx, mintx, valuex)
        if (!bals) return null
    }
    if (checkFees){
        const xFees = await feeCal(payerAddr, _addrs, _receives, _mints)
        const feeBals = await solBals([payerAddr], [xFees])
        if (!feeBals) return null
    }

    var txs = []
    const cx = new Map()
    for (let i = 0; i < _wallets.length; i++){
        setTimeout(async () => {
            const sr = await splRaw(payer, _wallets[i], _receives[i], _mints[i], _values[i], _addrs[i], cx)
            if (sr === null) return null
            const { raw, fees } = sr 
            const tx = await sendAndConfirmRawTransaction(connection, raw)
            txs.push(tx)
            log(i, tx)
        }, ts * i)
    }
    return txs
}

const wArea = (mnemonic, from, to) => {
    var area = []
    for (let i = from; i <= to; i++) {
        const { wallet } = create(mnemonic, i)
        area.push(wallet)
    }
    return area
}

const dArea = (mnemonic, from, to) => {
    var area = []
    for (let i = from; i <= to; i++) {
        const { address } = create(mnemonic, i)
        area.push(address)
    }
    return area
}

function readUInt64(buff, offset) {
    var word0 = buff.readUInt32LE(offset)
    var word1 = buff.readUInt32LE(offset + 4)
    return new BigNumber(word0).plus(new BigNumber(word1).times(0x100000000))
}

const typed = (buff, type) => {
    switch (type) {
        case 'u8':
            return new BigNumber(parseInt(buff.toString('hex'), 16))
        case 'u16':
            return new BigNumber(buff.readUInt16LE(0))
        case 'u32':
            return new BigNumber(buff.readUInt32LE(0))
        case 'u64':
            return readUInt64(buff, 0)
        case 'Pubkey':
            return (new PublicKey(buff)).toBase58()
        case 'COption<Pubkey>':

        default:
            return buff
    }
}

const unpack = (result, sizes, dgs, bk) => {
    if (result === null) return bk
    const raw = result.data
    var start = 0, nsize = []
    for (var i = 0; i < sizes.length; i++) {
        nsize.push(raw.slice(start, start + sizes[i]))
        start += sizes[i]
    }
    const data = {}
    for (let dg of dgs){

        data[dg.key] = typed(nsize[dg.index], dg.type)
    }
    return data
}

const batchRead = async (addrs, sizemap, filter) => {
    const pubAll = R.splitEvery(99, addrs.map( addr => new PublicKey(addr)))
    var results = []
    for (let pubs of pubAll) {
        const data = await connection.getMultipleAccountsInfo(pubs)
        results = results.concat(data)
    }

    var aggs = sizemap && filter ? results.map( result => unpack(result, sizemap, filter, { amount: new BigNumber(0) })) : results.map( result => result ? new BigNumber(result.lamports) : new BigNumber(0))
    return aggs
}

const getAtas = async (addrs, mints) => {
    var atas = [], cc = new Map(), multiMint = Array.isArray(mints)
    for (var i = 0; i < addrs.length; i++) {
        var _mint = multiMint ? mints[i] : mints
        if ( !cc.nget(addrs[i], _mint) ){
            var ata = await token.getAssociatedTokenAddress(new PublicKey(_mint), new PublicKey(addrs[i]))
            atas.push(ata.toBase58())
            cc.nset(ata.toBase58(), addrs[i], _mint)
        } else {
            atas.push(cc.nget(addrs[i], _mint))
        }
    }
    return atas
}

const cg = async (account, ata) => {
    var { lamports, data } = account
    if (data.toString('base64') === ''){
        lamports = M.divide(lamports, 1e9)
        return lamports
    }
    var pai = await connection.getParsedAccountInfo(ata)
    return pai.value.data.parsed.info.tokenAmount.uiAmount
}

const getBal = async (ata, mint) => {
    if (mint === undefined) return M.divide(await connection.getBalance(new PublicKey(ata)), 1e9)
    var { value } = await connection.getTokenAccountBalance(ata)
    return value.uiAmount
}

const remove = async (ata) => {
    await redis.srem("monitor", ata)
    await redis.del(ata)
}

const hook = async (endpoint, data) => {
    axios({
        method: 'post',
        url: endpoint,
        data: data
    }).then(res => {
        // console.log(res.data)
    }).catch(err => {})
}

var defaultPayer
var defaultSeed

const setDefaultPayer = (_defaultPayer) => {
    defaultPayer = _defaultPayer
}

const setDefaultSeed = (_defaultSeed) => {
    defaultSeed = _defaultSeed
}

const forward = async (derived, mint, dest) => {
    if (dest) {
        if (mint){
            const { wallet } = create(defaultSeed || process.env.mnemonic, derived)
            const txs = await splSend(wallet, dest, mint, {
                payer: defaultPayer || create(process.env.mnemonic, 0).wallet
            })
            log(txs[0])
            
            await redis.rpush('forward', txs[0])
        } else {
            const { wallet } = create(defaultSeed || process.env.mnemonic, derived)
            const txs = await solSend(wallet, dest, {
                payer: defaultPayer || create(process.env.mnemonic, 0).wallet
            })
            log(txs[0])
            
            await redis.rpush('forward', txs[0])
        }
        //SLA
    } else {
        await redis.rpush('depAddress', derived)
        await redis.rpush('depMint', mint)
    }
}

const loop = async (cb, mnts) => {
    for (let mnt of mnts) {
        const { address, mint, type, period, value, balance, minus, endpoint, dest, derived } = mnt
        const ata = mint ? await token.getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(address)) : new PublicKey(address)
        
        const _balance = balance ? balance : await getBal(ata, mint)
        const _mnt = mnt
        _mnt.balance = _balance
        
        await redis.sadd("monitor", ata)
        await redis.hmset(ata, _mnt)
        
        if (type){
            const id = connection.onAccountChange(ata, async (account, context) => {
                const { slot } = context
                const balCg = await cg(account, ata)
                const cgv = M.subtract(balCg, _balance)
                if (cgv >= value){
                    connection.removeAccountChangeListener(id)
                    clearTimeout(time)
                    await remove(ata)

                    log('Remove: ',id)
                    const tx = await connection.getSignaturesForAddress(ata, { limit: 1}, 'confirmed')
                    const result = {
                        address: address,
                        value: cgv,
                        mint: mint,
                        ata: ata.toBase58() || ata,
                        signature: tx[0].signature,
                        slot: slot
                    }
                    
                    if (cb) { cb(result) }
                    if (endpoint) { await hook(endpoint, result) }
                    await forward(derived, mint, dest)
                }
            })

            const time = setTimeout( async () => {
                connection.removeAccountChangeListener(id)
                await remove(ata)

                log('Remove: ',id)
            }, period)

            log('Listen: ',id)
        } else {
            const id = connection.onAccountChange(ata, async (account, context) => {
                const { slot } = context
                const balCg = await cg(account, ata)
                const balPrev = await redis.hget(ata, 'balance')
                await redis.hset(ata, 'balance', balCg)
                const cgv = M.subtract(balCg, balPrev)
                if (!(minus && cgv < 0)) {
                    const tx = await connection.getSignaturesForAddress(ata, { limit: 1}, 'confirmed')
                    const result = {
                        address: address,
                        value: cgv,
                        mint: mint,
                        ata: ata.toBase58() || ata,
                        signature: tx[0].signature,
                        slot: slot
                    }

                    if (cb) { cb(result) }
                    if (endpoint) { await hook(endpoint, result) }
                    await forward(derived, mint, dest)
                }
            })
            log('Listen: ',id)
        }
    }
}

const isNumeric = (str) => {
    if (typeof str !== "string") return false
    return !isNaN(str) && !isNaN(parseFloat(str))
}

const format = (_mnt) => {
    const _mntn = {}
    Object.keys(_mnt).map((key) => {
        if (_mnt[key] === '') return (_mntn[key] = undefined)
        if (isNumeric(_mnt[key])) return (_mntn[key] = Number(_mnt[key]))
        if (_mnt[key] == 'true') return (_mntn[key] = true)
        if (_mnt[key] == 'false') return (_mntn[key] = false)
        return (_mntn[key] = _mnt[key])
    })
    return _mntn
}

const monitor = async (opts) => {
    const { cb, mnts, reload } = opts
    if (mnts){
        await loop(cb, mnts)
    } else {
        const atas = await redis.smembers('monitor')
        const _mnts = []
        for (let ata of atas) {
            const _mnt = await redis.hgetall(ata)
            _mnts.push(format(_mnt))
        }
        if (reload) {
            // check MultiGet
        } else {
            await loop(cb, _mnts)
        }
    }
}

module.exports = {
    restore: restore,
    create: create,
    isAddrs: isAddrs,
    solBals: solBals,
    splBals: splBals,
    solSend: solSend,
    splSend: splSend,
    batchRead: batchRead,
    wArea: wArea,
    dArea: dArea,
    log: log,
    monitor: monitor,
    defaultSeed: setDefaultSeed,
    defaultPayer: setDefaultPayer
}