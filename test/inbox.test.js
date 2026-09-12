import { createInbox, TIMEOUT_PAYLOAD } from "../src/inbox.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const box = createInbox();

const parked = box.wait(1);
const raced = { from: "Torres", text: "chop" };
// push while waiting — must resolve immediately, not drop
box.push(raced);
const first = await parked;
assert(first.timed_out === false && first.text === "chop", "waiter gets mention");

// race window: mention while no waiter -> inbox, next wait drains
box.push({ from: "Torres", text: "again" });
const second = await box.wait(1);
assert(second.timed_out === false && second.text === "again", "drain inbox first");

const timed = await box.wait(1);
assert(timed.timed_out === true && timed.message === null, "timeout is normal");
assert(timed.instruction === TIMEOUT_PAYLOAD.instruction, "instruction present");
assert(!("isError" in timed), "no error flag");

console.log("inbox.test.js PASS");
