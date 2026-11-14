// 磁浮托盘换线模拟引擎（UMD：浏览器与 Node 共用）
// 物理模型：磁力推进/制动，无轮胎摩擦，无滑行阻尼（不加速不制动即匀速）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MaglevSim = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 轨道几何（单位：像素，1px 视为 0.01m 的可视化尺度）----
  var ARM = 350;            // 每条臂主轨长度（中心到端点）
  var SPAWN_S = -250;       // 托盘出发位置（主轨入口附近）
  var TARGET_S = 320;       // 停车目标
  var ZONE_R = 42;          // 中心占用区（保护区）半径
  var SWITCH_S = 18;        // 道岔动作点（相对中心）
  var MAX_SPEED = 130;      // 速度上限 px/s
  var PALLET_R = 16;        // 托盘半径

  var ARMS = ['N', 'E', 'S', 'W'];
  var ARM_VEC = {
    N: { x: 0, y: -1 },
    E: { x: 1, y: 0 },
    S: { x: 0, y: 1 },
    W: { x: -1, y: 0 }
  };
  // 线路归属：N-S 为 1 号线，E-W 为 2 号线
  var LINE_OF = { N: 1, S: 1, E: 2, W: 2 };
  var CARGO_TYPES = ['精密元件', '液冷电池', '超导线圈', '光学镜片'];

  // 固定 seed 的可复现随机数（mulberry32）
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 有向距离 s -> 画布坐标（沿入口臂->中心->出口臂的折线）
  function positionOnPath(enters, exits, s) {
    if (s <= 0) {
      var v0 = ARM_VEC[enters];
      // s 为负表示沿入口臂远离中心，坐标 = 反方向 × |s|
      return { x: -v0.x * s, y: -v0.y * s, arm: enters };
    }
    if (s <= ZONE_R) {
      return { x: 0, y: 0, arm: 'C' };
    }
    var v1 = ARM_VEC[exits];
    return { x: v1.x * (s), y: v1.y * (s), arm: exits };
  }

  // 固定 seed 生成 6 次换线任务（2 波，每波 3 车）
  function generateMissions(seed) {
    var rng = makeRng(seed);
    // 六次换线顺序执行（道岔联锁：一辆停稳后下一辆才放行）。
    // 约束：相邻任务入口/出口臂不重叠；同一辆车两次任务终点臂不同，
    // 从而避免同 id 托盘复用导致的几何重叠。
    // 每个托盘的入口臂固定为其 home 停靠臂，两次任务分别转往两条不同线路；
    // 任意任务的出口臂都不会是别的托盘 home，顺序执行无几何冲突。
    var routes = [
      { id: 'P0', enters: 'W', exits: 'N' },
      { id: 'P1', enters: 'N', exits: 'E' },
      { id: 'P2', enters: 'S', exits: 'E' },
      { id: 'P0', enters: 'W', exits: 'S' },
      { id: 'P1', enters: 'N', exits: 'W' },
      { id: 'P2', enters: 'S', exits: 'W' }
    ];
    var missions = [];
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i];
      var mass = Math.round((0.35 + rng() * 0.85) * 100) / 100;
      missions.push({
        id: m.id,
        index: i,
        enters: m.enters,
        exits: m.exits,
        lineFrom: LINE_OF[m.enters],
        lineTo: LINE_OF[m.exits],
        cargo: CARGO_TYPES[Math.floor(rng() * CARGO_TYPES.length)],
        mass: mass
      });
    }
    return missions;
  }

  // 根据玩家设定与货物质量计算实际加/减速度（磁力 F 恒定，a = F/m）
  function effectiveAccel(reqAccel, mass) {
    return reqAccel / mass;
  }
  function effectiveBrake(reqBrake, mass) {
    return reqBrake / mass;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  var DEPART_GAP = 0.8;      // 上一辆停稳后，下一辆的发车间隔（秒）
  var OVERSHOOT = 14;        // 越过目标多少 px 判定滑过

  // 三辆车各自的出发停靠站（depot），每次换线后回库清空线路
  var HOME_ARM = { P0: 'W', P1: 'N', P2: 'S' };
  // 侧线在臂末端的横向偏移（垂直于正线），使停靠托盘脱离主轨
  var SIDING_OFFSET = 34;

  function homePose(palletId) {
    var arm = HOME_ARM[palletId];
    var v = ARM_VEC[arm];
    // 垂直方向：N/S 臂沿 x 偏移，E/W 臂沿 y 偏移
    var tx = -v.y, ty = v.x;
    var end = ARM - 12;
    return { x: v.x * end + tx * SIDING_OFFSET, y: v.y * end + ty * SIDING_OFFSET, arm: arm };
  }

  World.prototype.homePose = function (palletId) {
    return homePose(palletId);
  };

  function World(opts) {
    opts = opts || {};
    this.dt = opts.dt || 1 / 120;
    this.t = 0;
    this.seed = opts.seed != null ? opts.seed : 239;
    this.missions = generateMissions(this.seed);
    // 每个托盘两波的玩家设定：accel / brakePoint / switchLead
    this.settings = opts.settings || defaultSettings(this.missions);
    this.events = [];
    this.status = 'running';   // running | success | failed
    this.failReason = null;
    this.completed = 0;
    this.zoneOccupant = null;  // 占用保护区的托盘对象
    this.switchLock = null;    // { pallet, exits }
    this.pallets = [];        // 当前在轨道上的托盘（同一时刻仅一辆活动）
    this.parked = [];          // 已停稳的托盘
    this.queue = this.missions.slice(1);
    this.nextDepartAt = 0;
    this.stats = { switchesOK: 0, conflicts: 0, collisions: 0, overshoots: 0 };
    this._spawn(this.missions[0], 0);
  }

  function defaultSettings(missions) {
    var s = {};
    for (var i = 0; i < missions.length; i++) {
      var m = missions[i];
      s[m.id + ':' + m.index] = {
        accel: 40,
        brakePoint: -100,
        switchLead: 0.5
      };
    }
    return s;
  }

  World.prototype._spawn = function (mission, departAt) {
    var key = mission.id + ':' + mission.index;
    var cfg = this.settings[key] || { accel: 40, brakePoint: -100, switchLead: 0.5 };
    // 同一辆车重新发车：移除它上一任务回库后的停靠实例，避免 depot 自碰撞
    this.parked = this.parked.filter(function (p) { return p.id !== mission.id; });
    this.pallets.push({
      id: mission.id,
      mission: mission,
      s: SPAWN_S,
      v: 0,
        mode: 'idle',            // idle|accel|coast|brake|stop|returning|estop
      enterZone: false,
      switchDone: false,
        switchAt: null,
      waiting: false,
        phase: 'outbound',       // outbound（换线）| returning（回库）
      departAt: departAt,
      cfg: cfg,
      result: null,
      x: 0, y: 0, arm: mission.enters,
      magnet: 0
    });
  };

  World.prototype.log = function (type, palletId, msg) {
    this.events.push({ t: Math.round(this.t * 1000) / 1000, type: type, id: palletId, msg: msg });
  };

  World.prototype._fail = function (reason) {
    if (this.status !== 'running') return;
    this.status = 'failed';
    this.failReason = reason;
    this.log('fail', null, reason);
  };

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  World.prototype.step = function () {
    if (this.status !== 'running') return false;
    var dt = this.dt;
    this.t += dt;
    var self = this;

    this.pallets.forEach(function (p) { self._stepPallet(p, dt); });
    this.parked.forEach(function (p) { self._refreshPose(p); });
    this._checkCollisions();
    this._checkWaveProgress();
    return this.status === 'running';
  };

  World.prototype._stepPallet = function (p, dt) {
    if (p.mode === 'stop' || p.mode === 'estop') {
      this._refreshPose(p);
      return;
    }
    if (p.mode === 'idle') {
      if (this.t >= p.departAt) {
        p.mode = 'accel';
        this.log('depart', p.id, p.id + ' 出发（' + p.mission.cargo + ' ' + p.mission.mass + 't）');
      } else {
        this._refreshPose(p);
        return;
      }
    }

    var m = p.mission;
    var a = 0;
    p.magnet = 0;

    if (p.mode === 'returning') {
      this._stepReturn(p, dt);
      this._handleZoneReverse(p);
      this._refreshPose(p);
      return;
    }

    // 制动点判定：越过即施制动磁轨（无摩擦，错过将一直滑向目标以外）
    if (p.s >= p.cfg.brakePoint && p.mode !== 'brake') {
      p.mode = 'brake';
      this.log('brake', p.id, p.id + ' 进入制动点 s=' + Math.round(p.s));
    }

    var decelMag = effectiveBrake(p.cfg.accel, m.mass);
    // 保护区联锁：占用区有其他托盘时，在入口边界前磁刹等待，禁止闯入
    var mustWait = false;
    if (this.zoneOccupant && this.zoneOccupant !== p && p.s < -ZONE_R) {
      var stopDist = (p.v * p.v) / (2 * decelMag);
      var boundary = -ZONE_R - PALLET_R - 2;
      if (p.s + stopDist >= boundary) mustWait = true;
      if (mustWait && !p.waiting) {
        p.waiting = true;
        this.log('zone-wait', p.id, p.id + ' 保护区被 ' + this.zoneOccupant.id + ' 占用，入口等待');
      }
    }
    if (!mustWait && p.waiting) {
      p.waiting = false;
      this.log('zone-go', p.id, p.id + ' 保护区清空，继续推进');
    }

    if (p.mode === 'brake' || mustWait) {
      a = -decelMag;
      p.magnet = -1;
    } else if (p.mode === 'accel') {
      a = effectiveAccel(p.cfg.accel, m.mass);
      p.magnet = 1;
      if (p.v >= MAX_SPEED) {
        p.mode = 'coast';
        p.v = MAX_SPEED;
      }
    }

    var vBefore = p.v;
    p.v = clamp(p.v + a * dt, 0, MAX_SPEED);
    // 制动到零：检查是否精准停在目标
    if (p.mode === 'brake' && p.v === 0 && vBefore > 0) {
      this._settle(p);
      this._refreshPose(p);
      return;
    }
    p.s += p.v * dt;

    this._handleSwitch(p);
    this._handleZone(p);
    this._refreshPose(p);
  };

  World.prototype._settle = function (p) {
    var overshoot = p.s - TARGET_S;
    if (Math.abs(overshoot) <= OVERSHOOT) {
      p.mode = 'stop';
      p.result = 'done';
      this.completed++;
      this.log('stop', p.id, p.id + ' 精准停靠目标（偏差 ' + Math.round(overshoot) + 'px）');
      // 停靠完成后自动回库，清空线路供下一辆使用
      p.mode = 'returning';
      p.phase = 'returning';
      p.enterZone = false;
      p.switchDone = false;
      this.log('return', p.id, p.id + ' 换线完成，磁浮回库至 ' + HOME_ARM[p.id] + ' 臂停靠站');
    } else if (overshoot > 0) {
      p.mode = 'estop';
      p.result = 'overshoot';
      this.stats.overshoots++;
      this._fail(p.id + ' 错过制动点，滑过目标 ' + Math.round(overshoot) + 'px');
    } else {
      // 制动过早，未到目标即停住（无摩擦无法再启动的失败情形之外，这里允许再次加速）
      p.mode = 'accel';
      this.log('reaccel', p.id, p.id + ' 未达目标，二次磁力推进');
    }
  };

  // 回库：沿换线路径反向匀速返回 depot，接近停靠站时磁刹
  World.prototype._stepReturn = function (p, dt) {
    var m = p.mission;
    var decelMag = effectiveBrake(p.cfg.accel, m.mass);
    var returnSpeed = Math.min(MAX_SPEED * 0.7, 80 + m.mass * 10);
    var stopDist = (returnSpeed * returnSpeed) / (2 * decelMag);
    var homeS = SPAWN_S;
    if (p.s - stopDist <= homeS) {
      // 接近停靠站，磁刹
      p.v = clamp(p.v - decelMag * dt, 0, MAX_SPEED);
      p.magnet = -1;
      if (p.v === 0 || p.s <= homeS) {
        p.s = homeS;
        p.v = 0;
        p.mode = 'stop';
        p.result = 'home';
        this.log('home', p.id, p.id + ' 已回库停靠，线路清空');
      }
    } else {
      p.v = returnSpeed;
      p.magnet = 1;
    }
    p.s -= p.v * dt;
    if (p.s < homeS) p.s = homeS;
  };

  // 回库反向穿越保护区的占用与释放
  World.prototype._handleZoneReverse = function (p) {
    var inside = p.s >= -ZONE_R && p.s <= ZONE_R;
    if (inside && !p.enterZone) {
      p.enterZone = true;
      this.zoneOccupant = p;
      this.log('zone-enter', p.id, p.id + ' 回库穿越中心占用区');
    }
    if (!inside && p.enterZone) {
      p.enterZone = false;
      if (this.zoneOccupant === p) {
        this.zoneOccupant = null;
        this.log('zone-leave', p.id, p.id + ' 回库离开中心占用区');
        if (this.switchLock && this.switchLock.pallet === p) this.switchLock = null;
      }
    }
  };

  // 道岔：按玩家设定的提前量在到达 SWITCH_S 前请求切换
  World.prototype._handleSwitch = function (p) {
    if (p.switchDone || p.mode === 'estop') return;
    if (p.s < SWITCH_S) {
      var eta = p.v > 1 ? (SWITCH_S - p.s) / p.v : Infinity;
      if (eta <= p.cfg.switchLead && p.switchAt === null) {
        p.switchAt = this.t;
        this._requestSwitch(p);
      }
    }
  };

  World.prototype._requestSwitch = function (p) {
    var needExit = p.mission.exits;
    // 联锁规则：保护区被其他托盘占用期间，禁止外来道岔切换。
    // 安全的提前量会在占用清空后请求；过早（强行）请求即判定冲突并急停。
    if (this.zoneOccupant && this.zoneOccupant !== p) {
      var conflictingLock = this.switchLock &&
        this.switchLock.pallet !== p && this.switchLock.exits !== needExit;
      // 占用方仍在区内时，任何非排队式的强制请求都触发急停
      this.stats.conflicts++;
      p.mode = 'estop';
      p.result = 'conflict';
      this.log('conflict', p.id, p.id + ' 道岔冲突：保护区被 ' + this.zoneOccupant.id +
        ' 占用' + (conflictingLock ? '且道岔锁向 ' + this.switchLock.exits : '') +
        '，仍强行切换至 ' + needExit + '，触发急停');
      this._fail('道岔冲突急停：' + p.id);
      return;
    }
    this._applySwitch(p);
  };

  World.prototype._applySwitch = function (p) {
    this.switchLock = { pallet: p, exits: p.mission.exits };
    p.switchDone = true;
    this.stats.switchesOK++;
    this.log('switch', p.id, p.id + ' 道岔切换 -> ' + p.mission.exits +
      '（' + p.mission.lineFrom + '号线转' + p.mission.lineTo + '号线）');
  };

  World.prototype._handleZone = function (p) {
    var inside = p.s >= -ZONE_R && p.s <= ZONE_R;
    if (inside && !p.enterZone) {
      p.enterZone = true;
      if (this.zoneOccupant && this.zoneOccupant !== p) {
        this.stats.collisions++;
        this._fail('碰撞：' + this.zoneOccupant.id + ' 与 ' + p.id + ' 同时进入保护区');
        p.mode = 'estop';
        p.result = 'collision';
        return;
      }
      this.zoneOccupant = p;
      this.log('zone-enter', p.id, p.id + ' 进入中心占用区');
    }
    if (!inside && p.enterZone) {
      p.enterZone = false;
      if (this.zoneOccupant === p) {
        this.zoneOccupant = null;
        this.log('zone-leave', p.id, p.id + ' 离开中心占用区');
        // 托盘离开保护区后释放道岔锁
        if (this.switchLock && this.switchLock.pallet === p) this.switchLock = null;
      }
    }
  };

  World.prototype._refreshPose = function (p) {
    // 已回库的托盘固定停在各自 home 臂的停靠站
    if (p.result === 'home') {
      var pose = homePose(p.id);
      p.x = pose.x;
      p.y = pose.y;
      p.arm = pose.arm;
      return;
    }
    var pose = positionOnPath(p.mission.enters, p.mission.exits, p.s);
    p.x = pose.x;
    p.y = pose.y;
    p.arm = pose.arm;
  };

  World.prototype._checkCollisions = function () {
    var minD = PALLET_R * 2 - 2;
    var all = this.pallets.concat(this.parked);
    for (var i = 0; i < all.length; i++) {
      for (var j = i + 1; j < all.length; j++) {
        var a = all[i], b = all[j];
        if (a.mode === 'idle' || b.mode === 'idle') continue;
        if (dist2(a.x, a.y, b.x, b.y) < minD * minD) {
          this.stats.collisions++;
          this._fail('碰撞：' + a.id + ' 与 ' + b.id + ' 在轨道上相撞');
          return;
        }
      }
    }
  };

  World.prototype._checkWaveProgress = function () {
    if (this.status !== 'running') return;
    var self = this;
    // 当前活动托盘停稳后，安排队列中的下一辆
    var active = this.pallets.filter(function (p) { return p.mode === 'stop' || p.mode === 'estop'; });
    var inFlight = this.pallets.filter(function (p) {
      return p.mode !== 'stop' && p.mode !== 'estop';
    });
    if (inFlight.length === 0 && this.queue.length > 0 && active.length > 0) {
      var last = active[active.length - 1];
      this.parked.push(last);
      this.pallets = this.pallets.filter(function (p) { return p !== last; });
      var next = this.queue.shift();
      var departAt = this.t + DEPART_GAP;
      this._spawn(next, departAt);
      this.log('dispatch', next.id, '放行 ' + next.id + '（第 ' + (next.index + 1) + ' 次换线，' +
        next.enters + '->' + next.exits + '）');
    } else if (inFlight.length === 0 && this.queue.length === 0 &&
      this.pallets.length > 0 && this.pallets.every(function (p) { return p.mode === 'stop'; })) {
      this.status = 'success';
      this.log('success', null, '六次换线全部完成且无碰撞，任务成功');
    }
  };

  return {
    ARM: ARM, SPAWN_S: SPAWN_S, TARGET_S: TARGET_S, ZONE_R: ZONE_R,
    SWITCH_S: SWITCH_S, MAX_SPEED: MAX_SPEED, PALLET_R: PALLET_R,
    ARMS: ARMS, ARM_VEC: ARM_VEC, LINE_OF: LINE_OF, CARGO_TYPES: CARGO_TYPES,
    makeRng: makeRng,
    effectiveAccel: effectiveAccel,
    effectiveBrake: effectiveBrake,
    World: World,
    DEPART_GAP: DEPART_GAP,
    HOME_ARM: HOME_ARM,
    SIDING_OFFSET: SIDING_OFFSET,
    homePose: function (palletId) { return homePose(palletId); },
    positionOnPath: positionOnPath,
    generateMissions: generateMissions
  };
});
