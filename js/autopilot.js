export function createDemoController() {
  return function demoController(state) {
    const [carA, carB] = state.cars;
    let payout = 0;
    let anchor = false;

    if (state.cable.tension > 950) {
      payout = 1;
    } else if (state.cable.tension < 320 && state.cable.target > 160) {
      payout = -1;
    }

    if (state.step < 70 && state.step % 25 < 9) {
      anchor = true;
    }

    if (state.success || state.failure) {
      return { throttle: 0, steer: 0, payout: 0, anchor: false };
    }

    const gateOneFraming = carA.y > 405 && carA.x < 575;
    const gateTwoFraming = carA.y > 285 && carA.y <= 405 && carA.x < 765;
    let steer = 0;

    if (gateOneFraming || gateTwoFraming) {
      steer = 0.16;
    } else if (carA.x > 790) {
      steer = -0.1;
    }

    const throttle = carA.finished && !carB.finished ? 0.18 : 1;
    return { throttle, steer, anchor, payout };
  };
}

export function runDemo(simulateStep, initialState, maxSteps = 900) {
  const state = structuredClone(initialState);
  const controller = createDemoController();
  const inputs = [];
  while (state.status === "live" && state.step < maxSteps) {
    const input = controller(state);
    inputs.push({ input, snapshot: null });
    simulateStep(state, input);
  }
  return { state, inputs };
}
