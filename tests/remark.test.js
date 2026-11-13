// node tests/remark.test.js
const assert = require("assert")
const { sanitizeRemark } = require("../pb_hooks/lib/remark.js")

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log("  ok  " + name)
}

console.log("备注富文本过滤")

check("编辑器产出的格式全部保留", () => {
  const html =
    '<b>加粗</b><font size="6">大字</font><font color="#cf1322">红字</font>' +
    '<img src="https://pb.example.com/api/files/remark_images/x/a.png" />'
  // 自闭合统一输出成 <img src="...">，浏览器渲染一致
  assert.strictEqual(sanitizeRemark(html), html.replace(" />", ">"))
})

check("纯文本原样保留（历史数据）", () => {
  assert.strictEqual(sanitizeRemark("身高 164，腰围 78"), "身高 164，腰围 78")
  assert.strictEqual(sanitizeRemark(""), "")
  assert.strictEqual(sanitizeRemark(null), "")
})

check("多行：div / br / p 保留", () => {
  assert.strictEqual(sanitizeRemark("<div>第一行</div><br><p>第二行</p>"), "<div>第一行</div><br><p>第二行</p>")
})

check("contenteditable 真实产物原样通过", () => {
  const html =
    '<div>第一行</div><div><br></div><div>第二行 <b>加粗</b> <font size="6"><font color="#cf1322">大红字</font></font></div>'
  assert.strictEqual(sanitizeRemark(html), html)
})

check("script 连内容一起删掉", () => {
  assert.ok(sanitizeRemark('<script>alert(1)</script>备注').indexOf("script") === -1)
  assert.ok(sanitizeRemark('<script>alert(1)</script>备注').indexOf("alert") === -1)
})

check("事件属性被剥掉", () => {
  assert.strictEqual(sanitizeRemark('<img src="https://a.com/b.png" onerror="alert(1)" />'), '<img src="https://a.com/b.png">')
  assert.strictEqual(sanitizeRemark('<b onclick="x()">字</b>'), "<b>字</b>")
})

check("非 http(s) 的图片地址被丢弃", () => {
  assert.strictEqual(sanitizeRemark('<img src="javascript:alert(1)" />'), "<img>")
  assert.strictEqual(sanitizeRemark('<img src="data:text/html;base64,xx" />'), "<img>")
})

check("白名单外的标签被转义成文本", () => {
  const out = sanitizeRemark("<table><tr><td>1</td></tr></table>")
  assert.ok(out.indexOf("<table") === -1, out)
  assert.ok(out.indexOf("&lt;table") === 0, out)
})

check("style 属性不放行（防覆盖后台界面）", () => {
  assert.strictEqual(sanitizeRemark('<b style="position:fixed;top:0">字</b>'), "<b>字</b>")
})

check("颜色/字号非法值被丢弃", () => {
  assert.strictEqual(sanitizeRemark('<font color="red">字</font>'), "<font>字</font>")
  assert.strictEqual(sanitizeRemark('<font size="99">字</font>'), "<font>字</font>")
})

check("未闭合的危险标签也不会漏出去", () => {
  assert.ok(sanitizeRemark("<iframe src=//evil>").indexOf("iframe") === -1)
})

console.log("\n" + passed + " 个用例全部通过")
