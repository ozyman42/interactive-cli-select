import * as e from "effect";
import { selectFromList } from "./index";
import { v4 as uuid } from "uuid";

const options = new Array(20).fill("").map(() => uuid());

console.log("confirm preprint");

e.Effect.runPromise(
  e.pipe(
    selectFromList({
      options,
      getKey: opt => opt,
      renderOption: opt => opt,
    }),
    e.Effect.match({
      onSuccess: chosen => {
        console.log("chose", chosen);
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
