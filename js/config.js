// 全局常量（单位：米、秒、m/s）。月面重力约为地球 1/6。
export const GRAVITY = 1.62;
export const WORLD = { width: 90, height: 66 };

export const MASS_BASE = 120;          // 空载质量 kg
export const MASS_PER_JAR = 14;         // 每罐样本增加的质量
export const MAX_SPEED = 6.2;           // 平地最大轮速 m/s
export const DRIVE_FORCE = 340;         // 轮端驱动力 N
export const ROLLING_DRAG = 0.55;       // 月尘滚动阻力系数（乘质量）
export const BRAKE_FORCE = 520;         // 基础制动力 N

export const TURN_RATE = 1.9;           // 低速转向角速度 rad/s
export const GRIP = 1.9;                // 月尘横向抓地：抓地极限 v*ω 超过即打滑
export const SLIP_GRIP = 0.5;           // 打滑时横向抓地骤降，车身持续外甩
export const SLIP_SIDE_SPEED = 0.95;    // 触发打滑的横向速度阈值 m/s
export const HIGH_SPEED_STEER = 2.2;    // 超过该速度后转向明显迟滞 m/s

export const HOP_TRIGGER_SLOPE = 0.34;  // 地形坡度超过该值触发低重力腾空
export const HOP_LIFT = 2.6;            // 初始上抛速度 m/s
export const LANDING_DAMAGE_SPEED = 3.4;// 落地垂直速度超过该值开始扣损伤
export const LANDING_DAMAGE_K = 9;      // 落地损伤系数

export const RIM_LANDSLIDE_DAMAGE = 26; // 碾过陨坑边缘触发滑坡的损伤
export const RIM_SIDE_KICK = 3.4;       // 滑坡给车体的横向冲击 m/s
export const STEEP_DAMAGE_RATE = 34;    // 陡坡上每秒持续损伤
export const DAMAGE_ABORT = 100;        // 损伤达到该值任务中止

export const PICKUP_RADIUS = 1.7;
export const LANDER_RADIUS = 2.4;
export const TOTAL_JARS = 3;

export const SEED = 20261115;
export const DT = 1 / 60;
