const R = require('ramda')
const allEqual = arr => arr.every( v => v === arr[0] )

const valid = (vs) => {
    const zero = vs.filter(v => v == 0)
    const nonZero = vs.filter(v => v !== 0)
    if (!allEqual(nonZero)) return null
    if (nonZero.length > 0) return nonZero[0]
    return 0
}

const len = (s) => {
    if (Array.isArray(s)) return s.length
    if (typeof s === 'string' || s instanceof String) return 0
    return 0
}

const fill = (s, ms) => {
    return len(s) == 0 ? Array(ms).fill(s) : s
}

const split = (s, ms, chunk) => {
    return R.splitEvery(chunk, fill(s, ms))
}

const spl = (_wallets, _receives, _mints, _values, chunk) => {
    console.log(len(_wallets), len(_receives), len(_mints), len(_values))
    const ms = valid([len(_wallets), len(_receives), len(_mints), len(_values)])
    if (ms === null) return ms
    if (ms == 0) return {
        _wallets: [[_wallets]],
        _receives: [[_receives]],
        _mints: [[_mints]],
        _values: [[_values]],
        _addrs: [[_wallets.publicKey.toBase58()]],
        addrx: [_wallets.publicKey.toBase58()],
        mintx: [_mints],
        valuex: [_values]
    }

    const addrs = fill(_wallets, ms).map(wallet => wallet.publicKey.toBase58())
    return {
        _wallets: split(_wallets, ms, chunk),
        _receives: split(_receives, ms, chunk),
        _mints: split(_mints, ms, chunk),
        _values: split(_values, ms, chunk),
        _addrs: split(addrs, ms, chunk),
        addrx: addrs,
        mintx: fill(_mints, ms),
        valuex: fill(_values, ms)
    }
}

const sol = (_wallets, _receives, _values, chunk) => {
    const ms = valid([len(_wallets), len(_receives), len(_values)])
    if (ms === null) return ms
    if (ms == 0) return {
        _wallets: [[_wallets]],
        _receives: [[_receives]],
        _values: [[_values]],
        _addrs: [[_wallets.publicKey.toBase58()]],
        addrx: [_wallets.publicKey.toBase58()],
        valuex: [_values]
    }
    const addrs = fill(_wallets, ms).map(wallet => wallet.publicKey.toBase58())
    return {
        _wallets: split(_wallets, ms, chunk),
        _receives: split(_receives, ms, chunk),
        _values: split(_values, ms, chunk),
        _addrs: split(addrs, ms, chunk),
        addrx: addrs,
        valuex: fill(_values, ms)
    }
}

module.exports = {
    sol: sol,
    spl: spl,
    len: len
}