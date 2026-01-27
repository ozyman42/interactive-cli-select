import * as e from "effect";
import { render } from "ink";
import { SelectFromList, type PossibleErrors } from "./components/select-from-list";
import { FetchOptionsError, SelectFromTree, SelectOptionError } from "./components/select-from-tree";
import { Color } from "./common";

export interface SelectFromListConfig<T> {
  options: T[];
  getKey: (option: T) => string;
  renderIndex?: (optionIndex: number, matchIndex: number) => string;
  renderOption: (option: T) => string;
  renderSelection?: (selected: boolean) => string;
  onEmptySearchDelete?: () => void;
  /**
   * How many options from the list of options to show at any given time
   */
  windowSize?: number;
  selectedColor?: Color;
  matchColor?: Color;
}

export const selectFromList = e.Effect.fn(function* <T>(config: SelectFromListConfig<T>) {
  return yield* e.Effect.async<T, PossibleErrors<T>>((resume) => {
    const { unmount, clear } = render(<SelectFromList
      options={config.options}
      renderIndex={config.renderIndex}
      renderOption={config.renderOption}
      renderSelection={config.renderSelection}
      windowSize={config.windowSize}
      onSelected={selected => {
        clear();
        unmount();
        resume(e.Effect.succeed(selected));
      }}
      getKey={config.getKey}
      onError={error => {
        clear();
        unmount();
        resume(e.Effect.fail(error));
      }}
      onEmptySearchDelete={config.onEmptySearchDelete}
      selectedColor={config.selectedColor}
      matchColor={config.matchColor}
    />)
  });
});

export { SelectFromList } from "./components/select-from-list";

export interface SelectFromTreeConfig<E> {
  root: string;
  getOptionKey: (priorChoices: string[], option: string) => string;
  renderOption: (priorChoices: string[], option: string) => string;
  renderTree?: (root: string, renderChoice: (choice: string) => string, priorChoices: string[]) => string;
  getOptions: (priorChoices: string[]) => e.Effect.Effect<string[], E>;
  /**
   * Only relevant when using the default render
   */
  choiceColor?: Color;
  selectedColor?: Color;
  matchColor?: Color;
}

export type SelectFromTreeErrors<E> = FetchOptionsError<E> | SelectOptionError;

export const selectFromTree = e.Effect.fn(function* <E>(config: SelectFromTreeConfig<E>) {
  return yield* e.Effect.async<string[], SelectFromTreeErrors<E>>((resume) => {

    const getOptions: (priorChoices: string[]) => e.Effect.Effect<string[], E> = e.Effect.fn(function* (priorChoices) {
      const options = yield* config.getOptions(priorChoices);
      // If there are no options, we assume we've traversed the entire tree.
      if (options.length === 0) {
        clear();
        unmount();
        resume(e.Effect.succeed(priorChoices));
      }
      return options;
    });

    const { unmount, clear } = render(<SelectFromTree
      root={config.root}
      getOptionKey={config.getOptionKey}
      renderOption={config.renderOption}
      renderTree={config.renderTree}
      getOptions={getOptions}
      onError={error => {
        clear();
        unmount();
        resume(e.Effect.fail(error));
      }}
      choiceColor={config.choiceColor}
      selectedColor={config.selectedColor}
      matchColor={config.matchColor}
    />)
  });
});

export { SelectFromTree, defaultRenderTree } from "./components/select-from-tree";
