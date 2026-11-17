// 从 index.html 中取出纯逻辑层（不依赖浏览器）直接执行，保证测的就是页面里的代码
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const start = html.indexOf('const DBG = (function () {');
// 结束标记只要求“行首缩进 + })();”，不绑定具体缩进宽度（index.html 历史上有 2/4 空格两种形态）
const endMatch = /\n[ \t]*\}\)\(\);/.exec(html.slice(start));
const end = endMatch ? start + endMatch.index : -1;
if (start < 0 || end < 0) { console.error('未能从 index.html 定位 DBG 模块'); process.exit(1); }
const src = html.slice(start, end + endMatch[0].length);

const mod = new Function(src + '\nreturn DBG;')();
const { parsePath, normalize, metricsOf, boundsOf, viewBoxOf, zoomBox, rotPt, arcSolve, segPoint, segLength, arcToCubics, fmt } = mod;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = typeof got === 'number' ? got.toFixed(4) : JSON.stringify(got);
  const w = typeof want === 'number' ? want.toFixed(4) : JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + g + '\n         want ' + w); }
};
const near = (name, got, want, tol) => eq(name, Math.abs(got - want) <= (tol || 1e-6) ? 'near' : `far(${got})`, 'near');
const codes = r => r.diagnostics.map(d => d.code + ':' + d.severity);
// PART C 的 renderDiagnostics 三分支：空输入必须优先于“未发现错误”
const hint = r => !r.source.trim().length ? 'paste-hint' : (r.diagnostics.length ? 'list' : 'clean');

console.log('— 语法 —');
eq('C+S 分段数', parsePath('M10 80 C40 10 65 10 95 80 S150 150 180 80').segments.map(s => s.type), ['M', 'C', 'S']);
eq('负号连写', parsePath('M10-20').segments.map(s => s.params), [[10, -20]]);
eq('小数连写', parsePath('M.5.6').segments.map(s => s.params), [[0.5, 0.6]]);
eq('指数', parsePath('M1e2 2e2').segments.map(s => s.params), [[100, 200]]);
eq('逗号', parsePath('M10,20').segments.map(s => s.params), [[10, 20]]);
eq('隐式 L', parsePath('M0 0 10 10').segments.map(s => s.type), ['M', 'L']);
eq('弧标志连写', parsePath('M0 0a1 1 0 0110 10').segments[1].params, [1, 1, 0, 0, 1, 10, 10]);
eq('弧标志连写段型', parsePath('M0 0a1 1 0 0110 10').segments[1].end, { x: 10, y: 10 });
eq('S 反射点', (() => { const s = parsePath('M0 0 C10 0 20 0 30 0 S50 0 60 0').segments[2]; return [s.c1.x, s.c1.y, s.reflected]; })(), [40, 0, true]);
eq('T 反射点', (() => { const s = parsePath('M0 0 Q10 10 20 0 T40 0').segments[2]; return [s.ctrl.x, s.ctrl.y, s.reflected]; })(), [30, -10, true]);
eq('子路径编号', parsePath('M0 0L10 10M20 20L30 30').segments.map(s => s.subpath), [0, 0, 1, 1]);
eq('subpathCount', parsePath('M0 0L10 10M20 20L30 30').subpathCount, 2);
eq('Z 端点', (() => { const s = parsePath('M5 6L10 10Z').segments[2]; return [s.end.x, s.end.y, !!s.closes]; })(), [5, 6, true]);
eq('相对命令', (() => { const s = parsePath('M10 10l5 5').segments[1]; return [s.relative, s.end.x, s.end.y]; })(), [true, 15, 15]);
eq('命令计数只计显式字母', [parsePath('M0 0 10 10').commandCount, parsePath('M0 0L10 10Z').commandCount], [1, 3]);
// 页面不做 trim，直接拿 textarea 原文解析，偏移必须与原始下标一致
eq('前导空白下诊断偏移与 textarea 下标一致', (() => {
  const raw = '\n\n  M 10 10 L x 30';
  const d = parsePath(raw).diagnostics.find(x => x.code === 'unexpected-token');
  return [d.start === raw.indexOf('x'), raw.indexOf('x')];
})(), [true, 14]);
eq('前导空白下有效前缀仍对齐', (() => {
  const raw = '  \n M 20 20 L 120 80 L 150 ';
  const r = parsePath(raw);
  return [raw.slice(0, r.consumedTo).trim(), r.segments.length, !parsePath(raw.slice(0, r.consumedTo)).error];
})(), ['M 20 20 L 120 80', 2, true]);
eq('超 64 位数字不静默切分', (() => {
  const r = parsePath('M ' + '9'.repeat(80) + ' 10');
  return [r.error || null, r.segments.length, r.segments[0].end.y];
})(), [null, 1, 10]);
eq('段数上限处段表与画布前缀一致', (() => {
  const d = 'M0 0' + ' L1 1'.repeat(20000);
  const r = parsePath(d);
  return [r.diagnostics.map(x => x.code).includes('too-many-segments'), r.segments.length,
    parsePath(d.slice(0, r.consumedTo)).segments.length];
})(), [true, 20000, 20000]);

console.log('— 诊断 —');
eq('缺 moveto', codes(parsePath('L10 10')), ['missing-moveto:error']);
eq('缺参数', codes(parsePath('M10')), ['missing-parameter:error']);
eq('弧标志非法', codes(parsePath('M1 1 A2 2 0 3 0 1 1')), ['invalid-arc-flag:error']);
eq('尾部逗号', codes(parsePath('M10 20,,')), ['trailing-comma:error']);
eq('逗号后无值', codes(parsePath('M10 20 L30,')), ['trailing-comma:error']);
eq('参数首位逗号', codes(parsePath('M10 20 L,30')), ['unexpected-comma:error']);
eq('非法字符', codes(parsePath('M10 20 L x 30')), ['unexpected-token:error']);
eq('错误命令不计入', parsePath('M 20 20 L 120 80 L 150 x 40').commandCount, 2);
eq('有效前缀保留', parsePath('M0 0L10 10Lbad').segments.length, 2);
eq('consumedTo 为最后完整命令末尾', parsePath('M0 0L10 10Lbad').consumedTo, 10);
eq('有效前缀自身可完整解析', (() => {
  const bads = ['M 20 20 L 120 80 L 150 x 40 Q 30 60', 'M0 0L10 10Lbad', 'L10 10', 'M10', 'M0 0 L 10 10 A 5 5 0 2 0 20 20,,'];
  return bads.every(d => { const r = parsePath(d); return !parsePath(d.slice(0, r.consumedTo)).error; });
})(), true);
eq('有效前缀末尾落在命令边界', (() => {
  const d = 'M 20 20 L 120 80 L 150 x 40';
  const r = parsePath(d);
  return [r.consumedTo, d.slice(0, r.consumedTo), r.segments.length];
})(), [16, 'M 20 20 L 120 80', 2]);
eq('有效前缀可重析', parsePath('M0 0L10 10Lbad').diagnostics[0].message.indexOf('第 12 个字符') >= 0, true);
eq('负半径告警', codes(parsePath('M0 0 A-5 5 0 0 1 10 0')), ['negative-arc-radius:warning']);
eq('零半径告警', codes(parsePath('M0 0 A0 0 0 0 1 10 0')), ['zero-arc-radius:warning']);
eq('半径放大告警', codes(parsePath('M0 0 A1 1 0 0 1 100 0')), ['arc-radii-scaled:warning']);
eq('弧起止重合', codes(parsePath('M10 10 A5 5 0 0 1 10 10')), ['arc-zero-length:warning']);
eq('孤立 moveto', codes(parsePath('M10 10')), ['lone-moveto:warning']);
eq('合法路径无诊断', codes(parsePath('M0 0L10 10Z')), []);
eq('诊断含位置', (() => { const d = parsePath('L10 10').diagnostics[0]; return [d.start, d.message.indexOf('第 1 个字符') >= 0]; })(), [0, true]);
eq('纯空白输入按未输入提示', hint(parsePath('\n   \t ')), 'paste-hint');
eq('合法输入提示无错误', hint(parsePath('M0 0L10 10')), 'clean');
eq('有诊断时列出条目', hint(parsePath('L10 10')), 'list');

console.log('— 几何 —');
const g = arcSolve(parsePath('M0 100 A50 50 0 0 1 100 100').segments[1]);
eq('圆心', [fmt(g.center.x, 3), fmt(g.center.y, 3)], ['50', '100']);
eq('角度', [fmt(g.theta1, 4), fmt(g.delta, 4)], ['3.1416', '3.1416']);
const full = parsePath('M0 0 A5 5 0 1 1 10 0 A5 5 0 1 1 0 0');
near('整圆周长', metricsOf(full.segments).length, 2 * Math.PI * 5, 1e-6);
near('直线长度', metricsOf(parsePath('M0 0 L30 40').segments).length, 50, 1e-9);
const poly = (s, N = 200000) => {
  let L = 0, prev = segPoint(s, 0);
  for (let i = 1; i <= N; i++) { const p = segPoint(s, i / N); L += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
  return L;
};
const lenCmp = (name, d) => {
  const s = parsePath(d).segments[1];
  const mine = segLength(s), ref = poly(s);
  eq(name, Math.abs(mine - ref) < 1e-4 ? 'near' : `far ${mine} vs ${ref}`, 'near');
};
lenCmp('贝塞尔长度（稠密折线对照）', 'M0 0 C0 50 50 50 50 0');
lenCmp('旋转椭圆弧长度', 'M0 0 A50 20 45 0 1 60 40');
lenCmp('大弧长度', 'M0 0 A10 10 0 1 1 1 0');
lenCmp('二次曲线长度', 'M0 0 Q50 50 100 0');
lenCmp('S 段长度', 'M0 0 C10 20 40 20 50 0 S90 -20 100 0');
lenCmp('T 段长度', 'M0 0 Q30 40 60 0 T120 0');
lenCmp('椭圆弧 sweep=0', 'M0 0 A50 20 30 0 0 60 40');
lenCmp('椭圆弧大弧 sweep=0', 'M0 0 A50 20 30 1 0 60 40');
eq('S 与展开后 C 等长', (() => {
  const a = parsePath('M0 0 C10 20 40 20 50 0 S90 -20 100 0');
  const b = parsePath(normalize(a.segments, { precision: 6, expandS: true, expandT: true }));
  return Math.abs(metricsOf(a.segments).length - metricsOf(b.segments).length) < 1e-6 ? 'eq' : 'diff';
})(), 'eq');
eq('T 段 bbox 含极值', (() => {
  const a = boundsOf(parsePath('M0 0 Q40 60 80 0 T160 0').segments);
  // T 反射 ctrl=(120,-60)，二次曲线极值在 t=0.5 → y = -30；前段 Q 极值 y = 30
  return [a.minY.toFixed(3), a.maxY.toFixed(3)];
})(), ['-30.000', '30.000']);
eq('S 段 bbox 含极值', (() => {
  const a = boundsOf(parsePath('M0 0 C10 40 40 40 50 0 S90 -40 100 0').segments);
  return a.maxY > 25 && a.minY < -25;
})(), true);
eq('椭圆 bbox', (() => { const b = boundsOf(parsePath('M0 0 C0 100 100 100 100 0').segments); return [b.minX, b.maxY]; })(), [0, 75]);
eq('圆弧 bbox', (() => { const b = boundsOf(parsePath('M0 0 A50 50 0 0 1 100 0').segments); return [b.minX, b.minY, b.maxX]; })(), [0, -50, 100]);
const cub = arcToCubics(parsePath('M0 100 A50 50 0 0 1 100 100').segments[1]);
eq('半圆分片数', cub.length, 2);
eq('分片末点', [fmt(cub[1].x, 3), fmt(cub[1].y, 3)], ['100', '100']);
eq('中点采样', (() => { const s = parsePath('M0 0 L10 0').segments[1]; return segPoint(s, 0.5).x; })(), 5);
eq('大弧分片数', arcToCubics(parsePath('M0 0 A10 10 0 1 1 1 0').segments[1]).length, 4);
const cubicAt = (p0, c1, c2, p3, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y
  };
};
eq('贝塞尔近似误差', (() => {
  const s = parsePath('M0 0 A50 20 30 1 1 60 40').segments[1];
  const cs = arcToCubics(s);
  let worst = 0;
  for (let i = 0; i <= 400; i++) {
    const gt = i / 400, k = Math.min(cs.length - 1, Math.floor(gt * cs.length)), t = gt * cs.length - k;
    const p0 = k === 0 ? s.start : { x: cs[k - 1].x, y: cs[k - 1].y };
    const q = cubicAt(p0, { x: cs[k].x1, y: cs[k].y1 }, { x: cs[k].x2, y: cs[k].y2 }, { x: cs[k].x, y: cs[k].y }, t);
    const p = segPoint(s, gt);
    worst = Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y));
  }
  return worst < 0.5 ? 'near' : 'far ' + worst.toFixed(4);
})(), 'near');

eq('弧长符号无关 sweep', (() => {
  const up = segLength(parsePath('M0 0 A50 20 0 0 1 100 0').segments[1]);
  const dn = segLength(parsePath('M0 0 A50 20 0 0 0 100 0').segments[1]);
  return [up > 0 && dn > 0, Math.abs(up - dn) < 1e-9];
})(), [true, true]);

console.log('— 取景 —');
// 检查模式取景：退化 bbox 不能“直接返回”，否则会沿用上一条路径的 viewBox 与标记比例
eq('单点取景回退基准尺寸', (() => {
  const v = viewBoxOf(boundsOf(parsePath('M 10 10 L 10 10').segments));
  return [v.box, v.unit];
})(), [[-20, -20, 60, 60], 0.1]);
eq('零宽但非零高仍按实际取景', (() => {
  const v = viewBoxOf(boundsOf(parsePath('M 10 10 L 10 30').segments));
  return [v.box.map(x => +x.toFixed(3)), +v.unit.toFixed(6)];
})(), [[-2.4, 7.6, 24.8, 24.8], 0.041333]);
eq('无几何回到默认画布', viewBoxOf(null), { box: [0, 0, 600, 600], unit: 1 });
eq('极小路径 viewBox 尺寸不致舍成 0', (() => {
  // 对应 PART C 的 fv()：小于 2 位小数必须保留有效位，否则 viewBox 宽高为 0 会禁用整个画布渲染
  const v = viewBoxOf(boundsOf(parsePath('M0 0L0.002 0.002').segments));
  const sizeStr = Number(v.box[2]).toFixed(8);
  const markerStr = Number(2.8 * v.unit).toFixed(8);
  return [sizeStr, markerStr];
})(), ['0.00248000', '0.00001157']);
// 描图/矢量化输出的直线化三次段（控制点等距）会把二阶差舍入成 0，走退化分支；
// 该分支曾漏掉 (0,1) 过滤，越界根（1e11 量级）代入贝塞尔公式得到 1e21 坐标，把取景冲垮致画布空白
eq('等距控制点不产生越界极值', (() => {
  const b = boundsOf(parsePath('M0 37.25 L10 37.25 C10 37.26 10 37.27 10 37.28').segments);
  return [b.minX, b.minY, b.maxX, b.maxY];
})(), [0, 37.25, 10, 37.28]);
eq('退化分支仍保留区间内的真实极值', (() => {
  // A=0、B≠0 的二次形三次段：t=0.5 是真极值，不能被同一过滤误删
  const b = boundsOf(parsePath('M0 0 C0 40 0 40 0 0').segments);
  return [fmt(b.maxY, 3), b.maxX];
})(), ['30', 0]);

console.log('— 手动缩放 —');
eq('居中缩放按视口中心等比', zoomBox([0, 0, 600, 600], 0.9), [30, 30, 540, 540]);
eq('锚点缩放保持锚点不动', (() => {
  const b = zoomBox([0, 0, 100, 100], 0.5, { x: 20, y: 20 });
  return [fmt(b[0], 4), fmt(b[1], 4), fmt(b[2], 4), fmt(b[3], 4)];
})(), ['10', '10', '50', '50']);
eq('放大缩小互逆回原盒', (() => {
  const b = zoomBox(zoomBox([12, -8, 300, 300], 0.9), 1 / 0.9);
  return [fmt(b[0], 6), fmt(b[1], 6), fmt(b[2], 6)];
})(), ['12', '-8', '300']);
eq('非法倍率/尺寸保持原盒', [zoomBox([0, 0, 600, 600], 0), zoomBox([0, 0, 0, 600], 0.9)], [[0, 0, 600, 600], [0, 0, 0, 600]]);
eq('深缩不越界舍成 0（下限 1e-3）', (() => {
  const b = zoomBox([0, 0, 600, 600], 1e-9);
  return [b[2] >= 1e-3, b[3] >= 1e-3];
})(), [true, true]);

console.log('— 角度旋转 —');
const rp = p => [fmt(p.x, 6), fmt(p.y, 6)];
eq('0° 短路逐字返回原值（角度盘归零靠它做无损还原）', rotPt(37.26, 99.991, 300, 300, 0), { x: 37.26, y: 99.991 });
eq('旋转中心在任意角度下不动', rp(rotPt(300, 300, 300, 300, 137)), ['300', '300']);
eq('正角为顺时针（y 轴向下，同 transform="rotate()"）', rp(rotPt(10, 0, 0, 0, 90)), ['0', '10']);
eq('180° 精确取反', rp(rotPt(10, 20, 0, 0, 180)), ['-10', '-20']);
eq('转 +θ 再转 −θ 为恒等', (() => {
  const p1 = rotPt(123.4, -56.7, 300, 200, 40);
  return rp(rotPt(p1.x, p1.y, 300, 200, -40));
})(), ['123.4', '-56.7']);
near('等距变换：到中心距离不变', (() => {
  const p = rotPt(10, 40, 300, 300, 123);
  return Math.hypot(p.x - 300, p.y - 300);
})(), Math.hypot(10 - 300, 40 - 300), 1e-9);
eq('非有限坐标原样返回（不产生新脏值）', rotPt(Infinity, 5, 0, 0, 30), { x: Infinity, y: 5 });

console.log('— 随机往返 —');
(() => {
  let seed = 20261113;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const n = v => (rnd() * 200 - 100).toFixed(rnd() < 0.3 ? 0 : (rnd() < 0.6 ? 2 : 4));
  let bad = 0, tried = 0;
  for (let i = 0; i < 600; i++) {
    let d = `M ${n()} ${n()}`;
    const parts = 3 + Math.floor(rnd() * 6);
    for (let j = 0; j < parts; j++) {
      const t = pick(['L', 'H', 'V', 'C', 'S', 'Q', 'T', 'A', 'Z']);
      if (t === 'Z') { d += ' Z'; continue; }
      const k = { L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[t];
      const args = [];
      for (let q = 0; q < k; q++) args.push(t === 'A' && (q === 3 || q === 4) ? (rnd() < 0.5 ? '0' : '1') : (q < 2 && t === 'A' ? (rnd() * 30 + 1).toFixed(1) : n()));
      d += ` ${pick([t, t.toLowerCase()])} ${args.join(pick([' ', ',', ' ']))}`;
    }
    const a = parsePath(d);
    tried++;
    if (a.error) continue;                       // 随机串可能不合法，只比对可解析者
    const mode = pick(['absolute', 'relative', 'source']);
    const out = normalize(a.segments, { mode, precision: 4, spacing: pick(['space', 'compact', 'comma']), expandHV: rnd() < 0.5, expandS: rnd() < 0.5, expandT: rnd() < 0.5 });
    const b = parsePath(out);
    if (b.error) { bad++; console.log('  重析失败: ' + out + '  →  ' + b.diagnostics[0].code); continue; }
    const ends = x => x.segments.map(s => [s.end.x, s.end.y]);
    const ea = ends(a), eb = ends(b);
    let worstEnd = 0;
    if (ea.length !== eb.length) { bad++; console.log('  段数不一致 ' + out); continue; }
    for (let q = 0; q < ea.length; q++) worstEnd = Math.max(worstEnd, Math.hypot(ea[q][0] - eb[q][0], ea[q][1] - eb[q][1]));
    if (worstEnd > 2e-3) {
      bad++;
      if (bad < 4) console.log(`  端点漂移 ${worstEnd}\n    d=${d}\n    out=${out}`);
    }
    const la = metricsOf(a.segments).length, lb = metricsOf(b.segments).length;
    if (Math.abs(la - lb) > Math.max(5e-3, Math.abs(la) * 1e-4)) { bad++; if (bad < 4) console.log(`  长度漂移 ${la} vs ${lb}\n    d=${d}\n    out=${out}`); }
  }
  eq(`随机往返 ${tried} 例`, bad, 0);
})();

console.log('— 摘要 —');
const m = metricsOf(parsePath('M0 0L10 0Z M20 20L30 20').segments);
eq('closedState', m.closedState, 'mixed');
eq('子路径统计', m.subpaths.length, 2);
eq('线段计数', m.segmentCount, 5);
eq('起点', m.start, { x: 0, y: 0 });
eq('开放', metricsOf(parsePath('M0 0L10 0').segments).closedState, 'open');
eq('空', metricsOf([]).closedState, 'empty');

console.log('— 规范化 —');
// fmt 在 |n| >= 1e21 时会退化为指数形式，此时不能剥尾零
eq('fmt 不破坏指数形式', fmt(1.2e30, 3), '1.2e+30');
eq('fmt 常规定点仍剥尾零', [fmt(1.5, 3), fmt(9.999, 2), fmt(-0.001, 2)], ['1.5', '10', '0']);
eq('大数量级规范化往返保值', (() => {
  const a = parsePath('M 0 0 L 1.2e30 2e20');
  return parsePath(normalize(a.segments, { precision: 3 })).segments[1].end;
})(), { x: 1.2e30, y: 2e20 });
const segs = parsePath('M10 20 L40.123456 20 H50 V30 L10 20 Z').segments;
eq('绝对/空格', normalize(segs, { precision: 2, spacing: 'space' }), 'M 10 20 L 40.12 20 H 50 V 30 L 10 20 Z');
eq('展开 H/V', normalize(segs, { precision: 2, expandHV: true }), 'M 10 20 L 40.12 20 L 50 20 L 50 30 L 10 20 Z');
eq('紧凑', normalize(segs, { precision: 2, spacing: 'compact' }), 'M10 20L40.12 20H50V30L10 20Z');
eq('逗号', normalize(segs, { precision: 0, spacing: 'comma' }), 'M10,20 L40,20 H50 V30 L10,20 Z');
eq('相对', normalize(parsePath('M10 10h5').segments, { mode: 'relative', precision: 1 }), 'm 10 10 h 5');
eq('保持原样（混合大小写）', normalize(parsePath('M10 10h5V30 l2 2z').segments, { precision: 0, mode: 'source' }), 'M 10 10 h 5 V 30 l 2 2 z');
eq('保持原样（隐式坐标对随 m 取小写）', normalize(parsePath('m10 10 20 20').segments, { precision: 0, mode: 'source' }), 'm 10 10 l 20 20');
eq('保持原样 + 展开 H/V', normalize(parsePath('M10 10h5').segments, { precision: 0, mode: 'source', expandHV: true }), 'M 10 10 l 5 0');
eq('保持原样往返端点一致', (() => {
  const a = parsePath('M10 10h5V30 l2 2c1 1 2 2 3 3z');
  const b = parsePath(normalize(a.segments, { precision: 4, mode: 'source' }));
  const e = x => x.segments.map(s => `${s.end.x},${s.end.y}`).join('|');
  return e(a) === e(b);
})(), true);
eq('展开 S', normalize(parsePath('M0 0C10 0 20 0 30 0S50 0 60 0').segments, { precision: 0, expandS: true }), 'M 0 0 C 10 0 20 0 30 0 C 40 0 50 0 60 0');
eq('展开 T', normalize(parsePath('M0 0Q10 10 20 0T40 0').segments, { precision: 0, expandT: true }), 'M 0 0 Q 10 10 20 0 Q 30 -10 40 0');
eq('展开 S 不影响 T', normalize(parsePath('M0 0S10 0 20 0T40 0').segments, { precision: 0, expandS: true }), 'M 0 0 C 0 0 10 0 20 0 T 40 0');
eq('弧标志粘连', normalize(parsePath('M0 0a1 1 0 0110 10').segments, { precision: 0, spacing: 'compact' }), 'M0 0A1 1 0 0110 10');
eq('弧标志粘连（相对）', normalize(parsePath('M0 0a1 1 0 0110 10').segments, { mode: 'relative', precision: 0, spacing: 'compact' }), 'm0 0a1 1 0 0110 10');
eq('旋转角不被粘连吞掉', normalize(parsePath('M0 0 A10 5 0 1 0 30 40').segments, { precision: 0, spacing: 'compact' }), 'M0 0A10 5 0 1030 40');
eq('负号粘连', normalize(parsePath('M10 20 L-5 30').segments, { precision: 0, spacing: 'compact' }), 'M10 20L-5 30');
eq('精度取整', normalize(parsePath('M10.567 20').segments, { precision: 1 }), 'M 10.6 20');
eq('完整精度不取整', normalize(parsePath('M10.567890123 20.1').segments, { precision: 'full' }), 'M 10.567890123 20.1');
eq('完整精度整数不带小数点', normalize(parsePath('M10 20.5').segments, { precision: 'full' }), 'M 10 20.5');
eq('完整精度往返端点一致', (() => { const a = parsePath('M1.23456789 2.34567891C3.45678912 4.56789123 5.67891234 6.78912345 7.89123456 8.91234567');
  const b = parsePath(normalize(a.segments, { precision: 'full' }));
  const e = x => x.segments.map(s => `${s.end.x},${s.end.y}`).join('|'); return e(a) === e(b); })(), true);
eq('相对模式往返坐标', (() => {
  const a = parsePath('M10 10 L20 20 L30 25');
  const b = parsePath(normalize(a.segments, { mode: 'relative', precision: 2 }));
  return b.segments.map(s => `${s.end.x},${s.end.y}`).join('|');
})(), '10,10|20,20|30,25');
eq('命令类型往返', (() => {
  const a = parsePath('M10 20 L40 20 H50 V30 L10 20 Z');
  const b = parsePath(normalize(a.segments, { precision: 3 }));
  return [a.segments.map(s => s.type).join(''), b.segments.map(s => s.type).join('')];
})(), ['MLHVLZ', 'MLHVLZ']);
eq('展开后坐标往返一致', (() => {
  const a = parsePath('M0 0C10 0 20 0 30 0S50 0 60 0Q5 5 7 8T9 9');
  const b = parsePath(normalize(a.segments, { precision: 4, expandS: true, expandT: true }));
  const e = x => x.segments.map(s => `${s.end.x},${s.end.y}`).join('|');
  return e(a) === e(b);
})(), true);
eq('半径不足保持原值', normalize(parsePath('M0 0 A1 1 0 0 1 100 0').segments, { precision: 1 }), 'M 0 0 A 1 1 0 0 1 100 0');

console.log(`\npass ${pass}, fail ${fail}`);
process.exit(fail ? 1 : 0);
