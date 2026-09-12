import { route, resetRoutingState } from "../src/routing.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

resetRoutingState();
const me = "Claude_Bot";

assert(route({ me, username: "Torres", plainMessage: "hello" }) === null, "unaddressed");
assert(route({ me, username: "Claude_Bot", plainMessage: "@claude hi" }) === null, "own name");
resetRoutingState();
const fromBot = route({ me, username: "Grok_Bot", plainMessage: "@claude hi" });
assert(fromBot === null, "bot messages never trigger model work");

resetRoutingState();
const hit = route({ me, username: "Torres", plainMessage: "@claude chop that tree" });
assert(hit && hit.text === "chop that tree" && hit.from === "Torres", "strict @claude");

resetRoutingState();
assert(route({ me, username: "Torres", plainMessage: "@grok come here" }) === null, "other bot");

resetRoutingState();
const all = route({ me, username: "Torres", plainMessage: "@all introduce yourselves" });
assert(all && all.isAll === true, "@all from human");

resetRoutingState();
assert(route({ me, username: "Grok_Bot", plainMessage: "@all hi" }) === null, "bot @all dropped");

resetRoutingState();
const first = route({ me, username: "Torres", plainMessage: "@claude one" }, 1000);
const second = route({ me, username: "Torres", plainMessage: "@claude two" }, 1100);
assert(first && second === null, "2s cooldown drops excess");

resetRoutingState();
const later = route({ me, username: "Torres", plainMessage: "@claude three" }, 4000);
assert(later && later.text === "three", "cooldown expired");

resetRoutingState();
const nametag = route({
  me,
  username: "Spectrumtantrum",
  plainMessage: "@Claude_Bot what are you doing?",
});
assert(
  nametag && nametag.text === "what are you doing?" && nametag.from === "Spectrumtantrum",
  "@Claude_Bot nametag form",
);

resetRoutingState();
assert(
  route({ me, username: "Spectrumtantrum", plainMessage: "Hi claude?" }) === null,
  "no @ still silence",
);

console.log("routing.test.js PASS");
