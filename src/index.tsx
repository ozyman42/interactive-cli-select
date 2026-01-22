import * as e from "effect";
import { render } from "ink";
import { SelectFromList, type PossibleErrors } from "./components/select-from-list";

export interface SelectFromListConfig<T> {
  options: T[];
  getKey: (option: T) => string;
  renderIndex?: (optionIndex: number, matchIndex: number) => string;
  renderOption: (option: T) => string;
  renderSelection?: (selected: boolean) => string;
  /**
   * How many options from the list of options to show at any given time
   */
  windowSize?: number;
}

export const selectFromList = e.Effect.fn(function* <T>(config: SelectFromListConfig<T>) {
  return yield* e.Effect.async<T, PossibleErrors<T>>((resume) => {
    render(<SelectFromList
      options={config.options}
      renderIndex={config.renderIndex}
      renderOption={config.renderOption}
      renderSelection={config.renderSelection}
      windowSize={config.windowSize}
      onSelected={selected => {
        resume(e.Effect.succeed(selected));
      }}
      getKey={config.getKey}
      onError={error => {
        resume(e.Effect.fail(error));
      }}
    />)
  })
  
});

// TODO
//export function selectFromTree
