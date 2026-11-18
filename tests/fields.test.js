// node tests/fields.test.js
const assert = require("assert")
const { pickFields } = require("../pb_hooks/lib/fields.js")

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log("  ok  " + name)
}

console.log("品类参数裁剪")

check("裁剪：床垫单只留身高，不会把档案里的胸围印出去", () => {
  const defs = [
    { key: "height", label: "身高", unit: "cm", type: "number", sort: 10 },
    { key: "chest", label: "胸围", unit: "cm", type: "number", sort: 20 },
    { key: "foot_length", label: "脚长", unit: "cm", type: "number", sort: 30 },
  ]
  const list = pickFields(defs, [{ key: "height", sort: 1 }])
  assert.deepStrictEqual(list.map((f) => f.key), ["height"])
})

check("裁剪：品类上的排序覆盖字段表排序", () => {
  const defs = [
    { key: "height", label: "身高", sort: 99 },
    { key: "foot_length", label: "脚长", sort: 1 },
  ]
  const list = pickFields(defs, [{ key: "height", sort: 1 }, { key: "foot_length", sort: 2 }])
  const sortMap = {}
  list.forEach((f) => (sortMap[f.key] = f.sort))
  assert.strictEqual(sortMap.height, 1)
  assert.strictEqual(sortMap.foot_length, 2)
})

check("裁剪：品类没配参数 = 空文本，不是全量", () => {
  const defs = [{ key: "height", label: "身高", sort: 1 }]
  assert.deepStrictEqual(pickFields(defs, []), [])
})

check("裁剪：不传绑定就返回全部（老订单兜底）", () => {
  const defs = [{ key: "height", label: "身高", sort: 1 }]
  assert.strictEqual(pickFields(defs).length, 1)
})

console.log("\n" + passed + " 项通过")
