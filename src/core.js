/*
 * AtlasCore: reads a GNU units definitions file and works out, for every unit, its value in
 * primitive units, its dimension and its direct building blocks, the way GNU units does.
 * Runs in the browser (the atlas page) and in node (to test it against GNU units itself).
 */
(function (root) {
  "use strict";
  const SETTINGS = { UNITS_SYSTEM: "default", UNITS_ENGLISH: "US" };
  const BOX_RE = /^#{20,}\s*$/;

  // ------------------------------------------------------------------ reading the file
  function logicalLines(text) {
    const raw = text.split(/\r?\n/), out = [];
    let buf = "", start = null;
    raw.forEach((line, k) => {
      if (start === null) start = k + 1;
      const t = line.replace(/\s+$/, "");
      if (t.endsWith("\\") && !line.trimStart().startsWith("#")) { buf += t.slice(0, -1) + " "; return; }
      out.push([start, buf + line]); buf = ""; start = null;
    });
    return out;
  }

  function splitComment(text) {
    const i = text.indexOf("#");
    return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 1).trim()];
  }

  /**
   * files: { "definitions.units": text, "currency.units": text, ... }
   * Returns { units: {key: entry}, order: [keys], missing: [included files not supplied] }.
   */
  function parseFiles(files, mainName) {
    const units = {}, order = [], state = { section: "", anchor: null }, missing = [];
    parseOne(mainName, files[mainName]);
    return { units, order, missing };

    function parseOne(fname, text) {
      const lines = logicalLines(text);
      const skip = [];
      let section = state.section, subsection = "", lastUnit = null;
      for (let i = 0; i < lines.length; i++) {
        const [no, line] = lines[i];
        const stripped = line.trim();
        const active = !skip.some(Boolean);
        const indented = /^\s/.test(line);
        // headings: a box of #### lines
        if (BOX_RE.test(stripped)) {
          let j = i + 1; const title = [];
          while (j < lines.length && lines[j][1].trim().startsWith("#") && !BOX_RE.test(lines[j][1].trim())) {
            const t = lines[j][1].trim().replace(/^#+|#+$/g, "").trim();
            if (t) title.push(t);
            j++;
          }
          if (j < lines.length && BOX_RE.test(lines[j][1].trim()) && title.length) {
            const first = title[0].split(/(?<=[.:])\s/)[0].replace(/[.:]+$/, "");
            if (first.length < 70) { section = first; subsection = ""; }
            i = j; lastUnit = null; continue;
          }
        }
        const prevComment = i > 0 && lines[i - 1][1].trim().startsWith("#");
        const prevBlank = i > 0 && !lines[i - 1][1].trim();
        // "#" / "# Title" / "#"
        if (stripped === "#" && i + 2 < lines.length && !prevComment) {
          const mid = lines[i + 1][1].trim();
          if (mid.startsWith("#") && lines[i + 2][1].trim() === "#") {
            const t = mid.replace(/^#+/, "").trim();
            if (t.length > 0 && t.length < 60 && !/https?:|=|\[/.test(t) && !t.endsWith(":")) subsection = t.replace(/\.$/, "");
          }
        }
        // blank / "# Title" / blank
        if (stripped.startsWith("#") && !indented && prevBlank && i + 1 < lines.length && !lines[i + 1][1].trim()) {
          const t = stripped.replace(/^#+/, "").trim().replace(/#+$/, "").trim();
          if (t.length > 0 && t.length < 60 && !/https?:|=|\[/.test(t) && !t.endsWith(":") && /^[A-Z]/.test(t)) subsection = t.replace(/\.$/, "");
        }
        // "# Roman measure.  The Romans had ..."
        if (stripped.startsWith("#") && !indented && prevBlank) {
          const m = /^#\s*([A-Z][^.:]{2,40}?)[.:]\s\s+\S/.exec(stripped);
          if (m && !/https?:|=/.test(m[1])) subsection = m[1].trim();
        }
        if (stripped.startsWith("#") || !stripped) {
          if (lastUnit && stripped.startsWith("#") && indented) {
            const c = stripped.replace(/^#+/, "").trim();
            const target = state.anchor || lastUnit;
            if (c && units[target]) units[target].comment = (units[target].comment + " " + c).trim();
          } else if (!stripped || !indented) {
            lastUnit = null;
            if (!stripped) state.anchor = null;
          }
          continue;
        }
        if (stripped.startsWith("!")) {
          const parts = splitComment(stripped)[0].trim().split(/\s+/), cmd = parts[0];
          if (cmd === "!var" || cmd === "!varnot") {
            const inside = parts.slice(2).includes(SETTINGS[parts[1]]);
            skip.push(cmd === "!var" ? !inside : inside);
          } else if (cmd === "!endvar") skip.pop();
          else if (cmd === "!locale") skip.push(true);
          else if (cmd === "!endlocale") skip.pop();
          else if (cmd === "!include" && active) {
            const inc = parts[1];
            if (files[inc] != null) { state.section = section; parseOne(inc, files[inc]); }
            else missing.push(inc);
          }
          lastUnit = null;
          continue;
        }
        if (!active) continue;
        const [body, comment0] = splitComment(line);
        const m = /^\s*(\S+)\s*(.*)$/.exec(body);
        if (!m) continue;
        let name = m[1], def = m[2].trim(), kind = "unit", param = null, tableUnit = null;
        if (name.endsWith("-")) { kind = "prefix"; name = name.slice(0, -1); }
        else if (name.includes("(")) { kind = "function"; const fm = /^([^(]+)\((.*)\)$/.exec(name); name = fm ? fm[1] : name; param = fm ? fm[2] : "x"; }
        else if (name.includes("[")) { kind = "table"; tableUnit = line.split("[")[1].split("]")[0]; name = name.split("[")[0]; }
        if (def.startsWith("!")) kind = def.includes("dimensionless") ? "dimensionless" : "primitive";
        let comment = comment0, continued = false;
        const a = state.anchor;
        if (comment && a && units[a] && units[a].comment && /^[a-z]/.test(comment) && !/[.!?)]\s*$/.test(units[a].comment)) {
          units[a].comment += " " + comment; comment = ""; continued = true;
        }
        const key = name + (kind === "prefix" ? "-" : "");
        if (units[key]) order.splice(order.indexOf(key), 1);     // the later definition wins
        units[key] = { name, kind, def, file: fname, line: no, section, subsection, comment, param, tableUnit };
        order.push(key);
        lastUnit = key;
        if (!continued) state.anchor = comment ? key : null;
      }
    }
  }

  // ------------------------------------------------------------------ quantities
  function Q(v, d) { return { v, d: d || {} }; }
  function mulD(a, b, s) {
    const d = Object.assign({}, a);
    for (const k in b) { const e = (d[k] || 0) + s * b[k]; if (Math.abs(e) < 1e-12) delete d[k]; else d[k] = e; }
    return d;
  }
  const mul = (a, b) => Q(a.v * b.v, mulD(a.d, b.d, 1));
  const div = (a, b) => Q(a.v / b.v, mulD(a.d, b.d, -1));
  function pow(a, e) {
    const d = {};
    for (const k in a.d) d[k] = a.d[k] * e;
    return Q(Math.pow(a.v, e), d);
  }
  function sameDims(a, b) {
    const ka = Object.keys(a.d), kb = Object.keys(b.d);
    return ka.length === kb.length && ka.every(k => Math.abs(a.d[k] - (b.d[k] || 0)) < 1e-9);
  }
  function isNum(q) { return Object.keys(q.d).length === 0; }

  // ------------------------------------------------------------------ the evaluator
  function Evaluator(parsed) {
    const U = parsed.units;
    const unitNames = new Map(), prefixNames = new Map();
    for (const k of parsed.order) {
      const u = U[k];
      if (u.kind === "prefix") prefixNames.set(u.name, k); else unitNames.set(u.name, k);
    }
    const prefixList = [...prefixNames.keys()].sort((a, b) => b.length - a.length);
    const memo = new Map(), busy = new Set();
    let collect = null;          // {deps:Set, prefixes:Set} for the definition being read

    /** Resolves a name the way GNU units does: exact, plural, prefix + unit, prefix alone. */
    function resolve(name) {
      if (unitNames.has(name)) return { key: unitNames.get(name) };
      for (const s of plurals(name)) if (unitNames.has(s)) return { key: unitNames.get(s) };
      for (const p of prefixList) {
        if (name.startsWith(p) && name.length > p.length) {
          const rest = name.slice(p.length);
          if (unitNames.has(rest)) return { key: unitNames.get(rest), prefix: p };
          for (const s of plurals(rest)) if (unitNames.has(s)) return { key: unitNames.get(s), prefix: p };
        }
      }
      if (prefixNames.has(name)) return { prefix: name };
      return null;
    }
    // GNU units: only names longer than two letters; first drop the s, then es, then ies -> y
    function plurals(w) {
      const out = [];
      if (w.length > 2 && w.endsWith("s")) {
        out.push(w.slice(0, -1));
        if (w.endsWith("es")) out.push(w.slice(0, -2));
        if (w.endsWith("ies")) out.push(w.slice(0, -3) + "y");
      }
      return out;
    }

    function prefixValue(p) { return valueOf(prefixNames.get(p)); }

    /** Value of a unit (or prefix) by key, as a quantity. */
    function valueOf(key) {
      if (memo.has(key)) return memo.get(key);
      const u = U[key];
      if (!u) throw new Error("Unknown unit " + key);
      if (busy.has(key)) throw new Error("Circular definition at " + u.name);
      busy.add(key);
      const saved = collect;
      collect = { deps: new Set(), prefixes: new Set() };
      let q;
      try {
        if (u.kind === "primitive" || u.kind === "dimensionless") q = Q(1, { [u.name]: 1 });
        else if (u.kind === "function" || u.kind === "table") q = null;
        else q = evalExpr(u.def, null);
        u.deps = [...collect.deps].filter(k => k !== key);
        u.prefixes = [...collect.prefixes];
      } finally {
        collect = saved;
        busy.delete(key);
      }
      memo.set(key, q);
      return q;
    }

    function lookupName(name, env) {
      if (env && Object.prototype.hasOwnProperty.call(env, name)) return env[name];
      let r = resolve(name), exp = 1;
      if (!r) {
        const m = /^(.*\D)(\d+)$/.exec(name);       // m2 = m^2, cm3 = cm^3
        if (m && m[1] && !m[1].endsWith("_")) { r = resolve(m[1]); exp = +m[2]; }
      }
      if (!r) throw new Error("Unknown unit '" + name + "'");
      let q = Q(1);
      if (r.key) {
        if (collect) collect.deps.add(r.key);
        const v = valueOf(r.key);
        if (v === null) throw new Error("'" + name + "' is a function or table");
        q = v;
      }
      if (r.prefix) {
        if (collect) collect.prefixes.add(r.prefix);
        q = mul(prefixValue(r.prefix), q);
      }
      return exp === 1 ? q : pow(q, exp);
    }

    // ---- tokenizer and parser
    function tokenize(s) {
      const toks = [];
      let i = 0;
      while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { if (toks.length && toks[toks.length - 1].t !== "sp") toks.push({ t: "sp" }); i++; continue; }
        if (c === "*" && s[i + 1] === "*") { toks.push({ t: "^" }); i += 2; continue; }
        if ("*/^|()+-,".includes(c)) { toks.push({ t: c }); i++; continue; }
        const num = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));
        if (num && (/\d/.test(c) || c === ".")) { toks.push({ t: "num", v: parseFloat(num[0]) }); i += num[0].length; continue; }
        let j = i;
        while (j < s.length && !/\s/.test(s[j]) && !"*/^|()+-,".includes(s[j])) j++;
        const w = s.slice(i, j);
        toks.push(w === "per" ? { t: "/" } : { t: "name", v: w });
        i = j;
      }
      while (toks.length && toks[toks.length - 1].t === "sp") toks.pop();
      return toks;
    }

    const FUNCS = {
      sqrt: q => pow(q, 0.5), cuberoot: q => pow(q, 1 / 3),
      exp: q => Q(Math.exp(num(q))), ln: q => Q(Math.log(num(q))), log: q => Q(Math.log10(num(q))),
      log2: q => Q(Math.log2(num(q))), sin: q => Q(Math.sin(num(q))), cos: q => Q(Math.cos(num(q))),
      tan: q => Q(Math.tan(num(q))), asin: q => Q(Math.asin(num(q)), angle()), acos: q => Q(Math.acos(num(q)), angle()),
      atan: q => Q(Math.atan(num(q)), angle()), sinh: q => Q(Math.sinh(num(q))), cosh: q => Q(Math.cosh(num(q))),
      tanh: q => Q(Math.tanh(num(q))), floor: q => Q(Math.floor(num(q))), ceil: q => Q(Math.ceil(num(q))),
      round: q => Q(Math.round(num(q))), abs: q => Q(Math.abs(q.v), q.d)
    };
    function num(q) { if (!isNum(q)) { const r = Object.keys(q.d).filter(k => !isDimless(k)); if (r.length) throw new Error("function expects a number"); } return q.v; }
    function angle() { return unitNames.has("radian") && U[unitNames.get("radian")].kind === "dimensionless" ? { radian: 1 } : {}; }
    function isDimless(name) { const k = unitNames.get(name); return k && U[k].kind === "dimensionless"; }

    function evalExpr(text, env) {
      const toks = tokenize(text);
      let p = 0;
      const peek = () => toks[p], next = () => toks[p++];
      const skipSp = () => { while (peek() && peek().t === "sp") p++; };

      function expr() {
        skipSp();
        let a = term();
        for (;;) {
          skipSp();
          const t = peek();
          if (t && (t.t === "+" || t.t === "-")) {
            next(); const b = term();
            if (!sameDims(a, b)) throw new Error("adding unlike quantities");
            a = Q(t.t === "+" ? a.v + b.v : a.v - b.v, a.d);
          } else return a;
        }
      }
      function term() {
        skipSp();
        let a;
        if (peek() && peek().t === "/") a = Q(1);        // "/s" means 1/s
        else a = product();
        for (;;) {
          skipSp();
          const t = peek();
          if (t && (t.t === "*" || t.t === "/")) { next(); skipSp(); const b = product(); a = t.t === "*" ? mul(a, b) : div(a, b); }
          else return a;
        }
      }
      // juxtaposition binds tighter than * and /
      function product() {
        let a = unary();
        for (;;) {
          const save = p;
          if (peek() && peek().t === "sp") p++;
          const t = peek();
          if (t && (t.t === "num" || t.t === "name" || t.t === "(")) { a = mul(a, unary()); }
          else { p = save; return a; }
        }
      }
      function unary() {
        skipSp();
        if (peek() && peek().t === "-") { next(); const q = unary(); return Q(-q.v, q.d); }
        if (peek() && peek().t === "+") { next(); return unary(); }
        return power();
      }
      function power() {
        const a = atom();
        skipSp0();
        if (peek() && peek().t === "^") {
          next(); skipSp();
          const e = unary();          // right associative
          if (!isNum(e)) throw new Error("exponent has a unit");
          return pow(a, e.v);
        }
        return a;
      }
      function skipSp0() {         // a space before ^ is allowed: "m ^ 2"
        const save = p;
        if (peek() && peek().t === "sp") { p++; if (!(peek() && peek().t === "^")) p = save; }
      }
      function atom() {
        skipSp();
        const t = next();
        if (!t) throw new Error("unexpected end");
        if (t.t === "num") {
          let v = t.v;
          // fractions: 1|3, highest precedence
          while (peek() && peek().t === "|") {
            next();
            const d = next();
            if (!d || d.t !== "num") throw new Error("fraction without denominator");
            v = v / d.v;
          }
          return Q(v);
        }
        if (t.t === "(") { const q = expr(); skipSp(); const c = next(); if (!c || c.t !== ")") throw new Error("missing parenthesis"); return q; }
        if (t.t === "name") {
          if (peek() && peek().t === "(") {      // function call
            next();
            const arg = expr(); skipSp();
            const c = next(); if (!c || c.t !== ")") throw new Error("missing parenthesis");
            return callFunction(t.v, arg);
          }
          return lookupName(t.v, env);
        }
        throw new Error("unexpected character '" + t.t + "'");
      }
      const q = expr();
      skipSp();
      if (p < toks.length) throw new Error("unexpected text after '" + text + "'");
      return q;
    }

    function callFunction(name, arg) {
      if (FUNCS[name]) return FUNCS[name](arg);
      let key = unitNames.get(name);
      if (!key || (U[key].kind !== "function" && U[key].kind !== "table")) throw new Error("unknown function " + name);
      if (collect) collect.deps.add(key);
      const u = U[key];
      if (u.kind === "function") {
        const fwd = functionBody(u);
        if (!fwd.expr) {                                  // alias: spherevol() spherevolume
          return callFunction(fwd.alias, arg);
        }
        const saved = collect; collect = null;
        try { return evalExpr(fwd.expr, { [u.param || "x"]: arg }); } finally { collect = saved; }
      }
      // table: piecewise linear interpolation, output in the table's unit
      const pts = u.def.replace(/noerror/g, "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const x = num(arg);
      let y = NaN;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
        if ((x >= x0 && x <= x1) || (x <= x0 && x >= x1)) { y = y0 + (y1 - y0) * (x - x0) / (x1 - x0); break; }
      }
      const saved = collect; collect = null;
      try { return mul(Q(y), evalExpr(u.tableUnit, null)); } finally { collect = saved; }
    }

    function functionBody(u) {
      let t = u.def.replace(/\b(units|domain|range)=[\[(][^\])]*[\])]/g, " ").replace(/\bnoerror\b/g, " ");
      t = t.split(";")[0].trim();
      if (!/[\s(*/^+]/.test(t) && unitNames.has(t) && U[unitNames.get(t)].kind === "function") return { alias: t };
      return { expr: t };
    }

    /** Output unit text of a function (units=[in;out]) or table, for its dimension. */
    function outUnit(u, depth) {
      if (u.kind === "table") return u.tableUnit;
      const m = /units=\[([^;\]]*);([^\]]*)\]/.exec(u.def);
      if (m) return m[2].trim() || "1";
      const fb = functionBody(u);
      if (fb.alias && (depth || 0) < 5) return outUnit(U[unitNames.get(fb.alias)], (depth || 0) + 1);
      return null;
    }
    /** Names used in a formula, found by scanning it (for functions, whose argument has no fixed value). */
    function scanDeps(text, args, into) {
      text = text.replace(/(^|[^A-Za-z_$%'\u00a0-\uffff\d])(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/g, "$1 ");
      for (const w of text.match(/[A-Za-z_$%'\u00a0-\uffff][A-Za-z0-9_$%'.\u00a0-\uffff]*/g) || []) {
        if (args.has(w) || FUNCS[w] || w === "per") continue;
        let r = resolve(w);
        if (!r) { const m = /^(.*\D)(\d+)$/.exec(w); if (m) r = resolve(m[1]); }
        if (r && r.key) into.deps.add(r.key);
        if (r && r.prefix) into.prefixes.add(r.prefix);
      }
    }

    /** Evaluates everything; returns per key {value, dims, deps, prefixes, error, outUnit}. */
    function run() {
      for (const k of parsed.order) {
        const u = U[k];
        try {
          if (u.kind === "function" || u.kind === "table") {
            const out = outUnit(u);
            // dependencies of the formula or the table unit
            const c = { deps: new Set(), prefixes: new Set() };
            if (u.kind === "table") scanDeps(u.tableUnit, new Set(), c);
            else {
              const fb = functionBody(u);
              if (fb.expr) scanDeps(fb.expr, new Set([u.param || "x"]), c);
              else if (unitNames.has(fb.alias)) c.deps.add(unitNames.get(fb.alias));
            }
            u.deps = [...c.deps].filter(x => x !== k);
            u.prefixes = [...c.prefixes];
            if (out) { const q = evalExpr(out, null); u.dims = q.d; u.outUnit = out; }
            else u.skip = "function without a fixed unit";
          } else {
            const q = valueOf(k);
            u.value = q.v; u.dims = q.d;
          }
        } catch (e) {
          u.error = e.message;
          if (!u.deps) { u.deps = []; u.prefixes = []; }
        }
        collect = null;
      }
    }
    return { run, resolve, evalExpr };
  }

  // ------------------------------------------------------------------ the data for the page
  const NAMES = {
    '{"m":1}': "Length", '{"m":2}': "Area", '{"m":3}': "Volume", '{"kg":1}': "Mass",
    '{"s":1}': "Time", '{"K":1}': "Temperature", '{"A":1}': "Electric current", '{"mol":1}': "Amount of substance",
    '{"cd":1}': "Luminous intensity", '{"radian":1}': "Angle", '{"sr":1}': "Solid angle", '{"US$":1}': "Money",
    '{"bit":1}': "Information", '{}': "Numbers and ratios", '{"s":-1}': "Frequency and activity",
    '{"m":1,"s":-1}': "Velocity", '{"m":1,"s":-2}': "Acceleration", '{"kg":1,"m":1,"s":-2}': "Force",
    '{"kg":1,"m":-1,"s":-2}': "Pressure and stress", '{"kg":1,"m":2,"s":-2}': "Energy, work and torque",
    '{"kg":1,"m":2,"s":-3}': "Power", '{"kg":1,"m":-3}': "Density", '{"kg":1,"m":-1}': "Linear density",
    '{"kg":1,"m":1,"s":-1}': "Momentum", '{"kg":1,"m":-1,"s":-1}': "Dynamic viscosity",
    '{"m":2,"s":-1}': "Kinematic viscosity", '{"A":1,"s":1}': "Electric charge",
    '{"A":-1,"kg":1,"m":2,"s":-3}': "Voltage", '{"A":-2,"kg":1,"m":2,"s":-3}': "Electrical resistance",
    '{"A":2,"kg":-1,"m":-2,"s":3}': "Electrical conductance", '{"A":2,"kg":-1,"m":-2,"s":4}': "Capacitance",
    '{"A":-2,"kg":1,"m":2,"s":-2}': "Inductance", '{"A":-1,"kg":1,"s":-2}': "Magnetic flux density",
    '{"A":-1,"kg":1,"m":2,"s":-2}': "Magnetic flux", '{"A":1,"m":-1}': "Magnetic field strength",
    '{"A":1,"m":2}': "Magnetic dipole moment", '{"A":-1,"kg":1,"m":1,"s":-3}': "Electric field strength",
    '{"A":-2,"kg":1,"m":3,"s":-3}': "Resistivity", '{"A":2,"kg":-1,"m":-3,"s":3}': "Conductivity",
    '{"A":1,"m":-2,"s":1}': "Electric displacement", '{"A":1,"m":1,"s":1}': "Electric dipole moment",
    '{"m":3,"s":-1}': "Volumetric flow rate", '{"kg":1,"s":-1}': "Mass flow rate", '{"m":-1}': "Wavenumber (per length)",
    '{"m":-2}': "Per area (incl. fuel consumption)", '{"m":-3}': "Per volume (number density)",
    '{"K":-1,"m":2,"s":-2}': "Specific heat", '{"m":2,"s":-2}': "Absorbed dose and specific energy",
    '{"kg":1,"m":-2}': "Area density", '{"kg":1,"m":-2,"s":-2}': "Specific weight",
    '{"cd":1,"m":-2}': "Luminance", '{"cd":1,"m":-2,"sr":1}': "Illuminance", '{"cd":1,"sr":1}': "Luminous flux",
    '{"kg":1,"m":2,"s":-1}': "Action and angular momentum", '{"kg":1,"m":2}': "Moment of inertia",
    '{"K":-1,"kg":1,"m":2,"s":-2}': "Entropy and heat capacity",
    '{"K":-1,"kg":1,"m":1,"s":-3}': "Thermal conductivity", '{"K":-1,"kg":1,"s":-3}': "Heat transfer coefficient",
    '{"kg":1,"s":-3}': "Intensity (power per area)", '{"kg":1,"s":-2}': "Surface tension",
    '{"A":1,"kg":-1,"s":1}': "Exposure (charge per mass)", '{"kg":-1,"mol":1}': "Molality",
    '{"m":-3,"mol":1}': "Concentration", '{"kg":1,"mol":-1}': "Molar mass", '{"m":3,"mol":-1}': "Molar volume",
    '{"mol":1,"s":-1}': "Catalytic activity", '{"wholenote":1}': "Note length (music)",
    '{"m":2,"s":-3}': "Absorbed dose rate", '{"bit":1,"s":-1}': "Data rate",
    '{"K":1,"kg":-1,"m":-2,"s":3}': "Thermal resistance", '{"m":4}': "Second moment of area",
    '{"kg":-1,"m":3}': "Specific volume", '{"kg":-1,"m":1}': "Length per mass (yarn count)",
    '{"m":1,"s":-3}': "Jerk", '{"radian":1,"s":-1}': "Angular velocity", '{"radian":1,"s":-2}': "Angular acceleration",
    '{"kg":1,"mol":-1,"s":-2}': "Energy per amount of substance"
  };
  function dimKey(d) {
    const keys = Object.keys(d).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + fmtExp(d[k])).join(",") + "}";
  }
  function fmtExp(e) { return Number.isInteger(e) ? String(e) : String(Math.round(e * 1000) / 1000); }
  const SUP = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", ".": "·" };
  function sup(n) { return String(n).split("").map(c => SUP[c] || c).join(""); }
  function dimFormula(d) {
    const keys = Object.keys(d);
    if (!keys.length) return "1";
    const ORDER = ["kg", "m", "s", "A", "K", "mol", "cd", "radian", "sr", "bit", "US$", "wholenote"];
    keys.sort((a, b) => ((ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)) || (a < b ? -1 : a > b ? 1 : 0));
    const numr = keys.filter(k => d[k] > 0).map(k => k + (d[k] !== 1 ? sup(fmtExp(d[k])) : ""));
    const den = keys.filter(k => d[k] < 0).map(k => k + (d[k] !== -1 ? sup(fmtExp(-d[k])) : ""));
    let s = numr.join("·") || "1";
    if (den.length) s += "/" + (den.length === 1 ? den[0] : "(" + den.join("·") + ")");
    return s;
  }

  /** Builds the page's data set from the files. */
  function build(files, mainName) {
    const parsed = parseFiles(files, mainName);
    const ev = Evaluator(parsed);
    ev.run();
    const U = parsed.units, ORDER = parsed.order;
    const groupOf = u => u.kind === "prefix" ? "prefix" : (u.dims ? dimKey(u.dims) : null);
    // GNU's own dimension names: the run of capitalised names that starts with LENGTH
    const EN = {};
    const li = ORDER.indexOf("LENGTH");
    if (li >= 0) for (let i = li; i < ORDER.length && /^[A-Z][A-Z_]+$/.test(U[ORDER[i]].name); i++) {
      const u = U[ORDER[i]]; if (u.dims) (EN[dimKey(u.dims)] = EN[dimKey(u.dims)] || []).push(u.name);
    }
    const members = new Map();
    for (const k of ORDER) { const g = groupOf(U[k]); if (g) { if (!members.has(g)) members.set(g, []); members.get(g).push(k); } }
    const usedBy = new Map();
    for (const k of ORDER) for (const d of U[k].deps || []) { if (!usedBy.has(d)) usedBy.set(d, []); usedBy.get(d).push(k); }
    const keep = ORDER.filter(k => groupOf(U[k]));
    const pos = new Map(keep.map((k, i) => [k, i]));
    const gids = [...members.keys()].sort((a, b) => members.get(b).length - members.get(a).length);
    const gindex = new Map(gids.map((g, i) => [g, i]));
    const units = keep.map(k => {
      const u = U[k], g = groupOf(u);
      const parent = (u.deps || []).find(d => d !== k && groupOf(U[d]) === g);
      let c = (u.comment || "").replace(/\s+/g, " ").trim();
      if (c.length > 400) c = c.slice(0, 400).replace(/\s+\S*$/, "") + " …";
      return {
        n: u.name, k: u.kind === "dimensionless" ? "d" : u.kind[0],
        d: u.def.replace(/\s+/g, " ").trim().slice(0, 300),
        v: u.value == null ? null : u.value, g: gindex.get(g),
        p: parent != null ? pos.get(parent) : null,
        dep: (u.deps || []).filter(d => pos.has(d)).map(d => pos.get(d)),
        use: (usedBy.get(k) || []).filter(d => pos.has(d)).map(d => pos.get(d)),
        pf: u.prefixes || [], sec: u.subsection || u.section, c, l: u.line, f: u.file,
        a: /^\S+$/.test(u.def) && (u.deps || []).length === 1 && !(u.prefixes || []).length && u.kind === "unit",
        o: u.outUnit || null
      };
    });
    const groups = gids.map(g => {
      const ks = members.get(g);
      let name, f, en;
      if (g === "prefix") { name = "Prefixes"; f = ""; en = []; }
      else { const d = JSON.parse(g); name = NAMES[g] || null; f = dimFormula(d); en = EN[g] || []; }
      let base = null;
      if (g !== "prefix" && g !== "{}") {
        const ones = ks.filter(k => U[k].value != null && Math.abs(U[k].value - 1) < 1e-12);
        const prim = ones.filter(k => U[k].kind === "primitive" || U[k].kind === "dimensionless");
        const nice = ones.filter(k => /^[\x00-\x7f]+$/.test(U[k].name) && !/^[A-Z][A-Z_]+$/.test(U[k].name));
        if (prim.length) base = prim[0];
        else if ((nice.length ? nice : ones).length) {
          const use = k => (usedBy.get(k) || []).filter(x => groupOf(U[x]) === g).length;
          base = (nice.length ? nice : ones).reduce((a, b) => (use(b) > use(a) || (use(b) === use(a) && b.length < a.length)) ? b : a);
        }
      }
      return { name, f, en, n: ks.length, base: base != null ? pos.get(base) : null };
    });
    const errors = ORDER.filter(k => U[k].error && !U[k].skip).map(k => ({ name: U[k].name, file: U[k].file, line: U[k].line, error: U[k].error }));
    const vm = /^#[ \t]*([^\s#].*Version.*)$/m.exec(files[mainName] || "");
    return {
      units, groups, errors, missing: parsed.missing,
      meta: { version: vm ? vm[1].trim() : mainName, count: units.length },
      raw: parsed
    };
  }

  const api = { parseFiles, Evaluator, build, dimKey, dimFormula };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AtlasCore = api;
})(typeof window !== "undefined" ? window : globalThis);
