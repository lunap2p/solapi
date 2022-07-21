Map.prototype.incr = function (key, value) {
    var v = this.get(key)
    if (v === undefined){
        this.set(key, 0)
        v = 0
    }
    this.set(key, v + value)
    return this.get(key)
}

Map.prototype.push = function (key, value) {
    if (this.get(key) === undefined){
        this.set(key, [])
    }
    this.get(key).push(value)
    return this.get(key)
}

Map.prototype.concat = function (..._maps) {
    for (let _map of _maps) {
        _map.forEach((value, key) => {
            this.set(key, value)
        })
    }
    return this
}

Map.prototype.nset = function (value, ...keys) {
    var s = keys[0]
    for (var i = 1; i < keys.length; i++) {
        s = s + '=>' + keys[i]
    }
    this.set(s, value)
    return this
}

Map.prototype.nget = function (...keys) {
    var s = keys[0]
    for (var i = 1; i < keys.length; i++) {
        s = s + '=>' + keys[i]
    }
    return this.get(s)
}

Map.prototype.nincr = function (value, ...keys) {
    var v = this.nget(...keys)
    if (v === undefined){
        this.nset(0, ...keys)
        v = 0
    }
    this.nset(v + value, ...keys)
    return this.nget(...keys)
}

module.exports = Map