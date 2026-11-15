#!/usr/bin/env bash
# 一键流水线：生成六条字幕工程 -> 导出三文件 -> 重载一致性检查 -> 引擎/前端测试。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==== 1/4 构建演示工程并导出 ===="
node scripts/build_demo.js
echo
echo "==== 2/4 重载并核对三种导出文件 ===="
node scripts/verify_outputs.js
echo
echo "==== 3/4 浏览器引擎对等性测试 ===="
node scripts/test_web_core.js
echo
echo "==== 4/4 前端 DOM 冒烟测试 ===="
node scripts/test_app_smoke.js
echo
echo "全部流水线通过。"
