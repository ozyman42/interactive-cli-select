import * as e from "effect";
import { selectFromList, selectFromTree } from "./index";
import { v4 as uuid } from "uuid";

function getOptions(): e.Effect.Effect<string[]> {
  return e.Effect.async(resume => {
    const options = new Array(20).fill("").map(() => uuid());
    setTimeout(() => {
      resume(e.Effect.succeed(options));
    }, Math.random() * 5000);
  });
}

console.log("confirm preprint");

e.Effect.runPromise(
  e.pipe(
    selectFromTree({
      root: "testing",
      getOptionKey: (nodes, option) => option,
      getOptions: e.Effect.fn(function* (nodes) {
        if (nodes.length === 5) {
          return [];
        }
        return yield* getOptions();
      }),
      renderOption: (nodes, option) => `option ${option}`
    }),
    e.Effect.match({
      onSuccess: chosen => {
        console.log("chose nodes", chosen);
      },
      onFailure: error => {
        console.log("failed with error", error);
      }
    }),
    e.Effect.map(() => {
      process.exit();
    })
  )
);
