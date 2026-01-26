import React from "react";
import { Box, Text, useInput } from "ink";
import * as e from "effect";
import stripAnsi from "strip-ansi";
import { Color } from "../common";

export class DuplicateEntryError<T> extends e.Data.TaggedError("DuplicateEntryError")<{ one: T, two: T }> { }
export class NoEntriesError extends e.Data.TaggedError("NoEntriesError")<{}> { }

export type PossibleErrors<T> = 
  DuplicateEntryError<T> |
  NoEntriesError

export interface Props<T> {
  prefix?: {
    allLines: string;
    firstLineOnly: string;
  };
  options: T[];
  getKey: (option: T) => string;
  renderIndex?: (optionIndex: number, matchIndex: number) => string;
  renderOption: (option: T) => string;
  renderSelection?: (selected: boolean) => string;
  windowSize?: number;
  onSelected: (option: T) => void;
  onError: (error: PossibleErrors<T>) => void;
}

function assertElement<T>(arr: T[], index: number): T {
  const element = arr[index];
  if (element === undefined) {
    // TODO: make effectful somehow
    throw new Error(`No element at index ${index}`);
  }
  return element;
}

const ALPHANUMERIC = /^[a-zA-Z0-9 ]$/;

function alphabeticalDistance(one: string, two: string): number {
  const oneLower = one.toLocaleLowerCase();
  const twoLower = two.toLocaleLowerCase();
  const shortest = one.length < two.length ? one : two;
  // Go through each char until you reach the first mismatch. Compute the difference
  // Divide by 26 (letters in the alphabet) for each letter out the mismatch occurs.
  for (let i = 0; i < shortest.length; ++i) {
    const distance = Math.abs(oneLower.charCodeAt(i) - twoLower.charCodeAt(i));
    if (distance > 0) {
      return distance / (26 ** i);
    }
  }
  return 0;
}

export type OptionEntry<T> = {
  key: string;
  option: T;
  render: string;
}

type SortedEntriesResult<T> = e.Data.TaggedEnum<{
  Success: { sorted: OptionEntry<T>[]; first: OptionEntry<T>; };
  DuplicateKeyError: { one: T; two: T; };
  EmptyError: {};
}>;

type Selection<T> = {
  optionEntry: OptionEntry<T>;
  windex: number;
}

function sortedEntries<T>(options: T[], getKey: (option: T) => string, render: (option: T) => string): SortedEntriesResult<T> {
  const SortedEntriesResult = e.Data.taggedEnum<SortedEntriesResult<T>>();
  const optionsByKey: Record<string, OptionEntry<T>> = {};
  for (const option of options) {
    const key = getKey(option);
    const existing = optionsByKey[key];
    if (existing !== undefined) {
      return SortedEntriesResult.DuplicateKeyError({ one: existing.option, two: option });
    }
    optionsByKey[key] = {
      key,
      option,
      render: render(option)
    };
  }
  const sorted: OptionEntry<T>[] = Array.from(Object.values(optionsByKey)).sort((a, b) => {
    if (a.render > b.render) {
      return 1;
    } else if (a.render === b.render) {
      return 0;
    } else {
      return -1;
    }
  });
  const first = sorted[0];
  if (first === undefined) {
    return SortedEntriesResult.EmptyError();
  }
  return SortedEntriesResult.Success({ sorted, first });
}

function closestOption<T>(containedIn: OptionEntry<T>[], to: string): number {
  // Walk through new options until we find place that current selection would be
  for (const [index, cur] of Object.entries(containedIn)) {
    if (to < cur.render) {
      const curIndex = parseInt(index);
      if (curIndex === 0) return curIndex;
      // Given two possible indices we need to figure out which of the two is closest
      const prevIndex = curIndex - 1;
      const prev = containedIn[prevIndex]!;
      const curDist = alphabeticalDistance(cur.render, to);
      const prevDist = alphabeticalDistance(prev.render, to);
      if (curDist < prevDist) return curIndex;
      else return prevIndex;
    }
  }
  return containedIn.length - 1;
}

// TODO what is the behavior when matches contains multiple renders which are the same string but come from
// different options?
function closestMatch<T>(matches: Set<string>, options: OptionEntry<T>[], fromIndex: number): e.Option.Option<number> {
  if (matches.size === 0) {
    return e.Option.none();
  }
  const from = assertElement(options, fromIndex);
  if (matches.has(from.render)) {
    return e.Option.some(fromIndex);
  }
  // We search in both directions until we find a match.
  let high = fromIndex + 1;
  let low = fromIndex - 1;
  do {
    const curHigh = options[high];
    const curLow = options[low];
    const highMatches = curHigh !== undefined && matches.has(curHigh.render);
    const lowMatches = curLow !== undefined && matches.has(curLow.render);
    if (lowMatches && highMatches) {
      const lowDist = alphabeticalDistance(curLow.render, from.render);
      const highDist = alphabeticalDistance(curHigh.render, from.render);
      if (lowDist < highDist) return e.Option.some(low);
      else return e.Option.some(high);
    } else if (lowMatches) {
      return e.Option.some(low);
    } else if (highMatches) {
      return e.Option.some(high);
    } else {
      if (low >= 0) low--;
      if (high < options.length) high++;
    }
  } while (low >= 0 || high < options.length);
  throw new Error("Not possible for us to walk through entire options list without finding match");
}

type UpdateWindowConfig<T> = {
  windowSize: number;
  newSearch: string;
  newOptions: OptionEntry<T>[];
  currentSelection: Selection<T>;
  setMatches: (matches: number[]) => void;
  setSearch: (search: string) => void;
  setCurWindow: (window: { start: number; end: number }) => void;
  setSelected: (selection: Selection<T>) => void;
}

function updateWindow<T>(config: UpdateWindowConfig<T>) {
  const {
    currentSelection,
    newOptions,
    newSearch,
    setCurWindow,
    setMatches,
    setSearch,
    setSelected,
    windowSize
  } = config;
  const indexOfSelection = newOptions.findIndex(option => option.key === currentSelection.optionEntry.key);
  const matches = newOptions
    .map((option, index) => [index, option] as const)
    .filter(([index, option]) => option.render.includes(newSearch));
  const matchesSet = new Set(matches.map(([index, option]) => option.render));
  const maybeNewSelectionIndex =
    closestMatch(
      matchesSet,
      newOptions,
      indexOfSelection === -1 ?
        closestOption(newOptions, currentSelection.optionEntry.render) :
        indexOfSelection
    );
  if (e.Option.isNone(maybeNewSelectionIndex)) {
    if (matchesSet.size === 0) {
      // Don't change the selection since the window will be empty. It can be updated next time the window is non-empty.
      setMatches([]);
      setSearch(newSearch);
      setCurWindow({start: -1, end: -1});
      return;
    } else {
      throw new Error("Not possible to have no selection but a non-empty match set");
    }
  }
  const newSelectedIndex = maybeNewSelectionIndex.value;
  const newSelectedOption = assertElement(newOptions, newSelectedIndex);
  const matchIndex = matches.map(([index, option]) => option.key).indexOf(newSelectedOption.key);
  // We try to preserve the windex, but in practice cases exist where we can't honor that.
  const effectiveWindowSize = Math.min(windowSize, matches.length);
  const boundedWindex =
    currentSelection.windex >= effectiveWindowSize ? effectiveWindowSize - 1 :
    currentSelection.windex < 0 ? 0 :
    currentSelection.windex;
  // We need to adjust the windex such that the biggest window possible in the windowSize constraint is possible
  const impliedWindowStart = matchIndex - boundedWindex;
  const impliedWindowEnd = matchIndex + (effectiveWindowSize - (boundedWindex + 1));
  const newWindex =
    impliedWindowStart < 0 ? boundedWindex + impliedWindowStart : // move windex backwards
    impliedWindowEnd >= matches.length ? boundedWindex + (impliedWindowEnd + 1 - matches.length) : // move windex forwards
    boundedWindex;
  const adjustedWindowStart = matchIndex - newWindex;
  const adjustedWindowEnd = matchIndex + (effectiveWindowSize - (newWindex + 1));
  // We want an effect where
  // 1. First element and last element always displayed
  // 2. When more than 1 element stands between the start of the window and the first element, display a distance count
  // 3. Same as point 2 for the end
  const startIsFirst3 = adjustedWindowStart <= 2;
  const endIsLast3 = adjustedWindowEnd >= matches.length - 3;
  const finalWindowStart =
    startIsFirst3 ? 0 :
    endIsLast3 ? Math.max(0, matches.length - (effectiveWindowSize + 2)) :
    adjustedWindowStart;
  const finalWindex = newWindex + (adjustedWindowStart - finalWindowStart);
  const finalWindowEnd =
    startIsFirst3 ? Math.min((effectiveWindowSize + 2) - 1, matches.length - 1) :
    endIsLast3 ? matches.length - 1 :
    adjustedWindowEnd;
  setMatches(matches.map(([index, option]) => index));
  setSearch(newSearch);
  setSelected({ optionEntry: newSelectedOption, windex: finalWindex });
  assertElement(matches, matchIndex);
  setCurWindow({
    start: finalWindowStart,
    end: finalWindowEnd
  });
}

const Cursor: React.FC<{ children: React.ReactNode | React.ReactNode[]; altColor?: { blink: Color; normal: Color } }> = (props) => {
  const [blink, setBlink] = React.useState(true);
  React.useEffect(() => {
    const intervalId = setInterval(() => {
      setBlink((prevBlink) => !prevBlink);
    }, 500);
    return () => {
      clearInterval(intervalId);
    }
  }, []);
  if (blink) {
    return <Text backgroundColor={"white"} color={props.altColor ? props.altColor.blink : "black"}>
      {props.children}
    </Text>
  } else {
    return <Text color={props.altColor ? props.altColor.normal : "white"}>
      {props.children}
    </Text>
  }
}

const Prefix: React.FC<{ prefix?: { allLines: string; firstLineOnly: string; }; isFirstLine?: true; }> = ({prefix, isFirstLine}) => {
  if (prefix === undefined) {
    return null;
  } else {
    const nonFirstLinePrefixLen = stripAnsi(prefix.firstLineOnly).length;
    const nonFirstLinePrefix = "".padStart(nonFirstLinePrefixLen, " ");
    if (isFirstLine) {
      return <Text>
        {prefix.allLines}{prefix.firstLineOnly}
      </Text>;
    } else {
      return <Text>
        {prefix.allLines}{nonFirstLinePrefix}
      </Text>
    }
  }
}

function shouldMaybeAllowTabComplete<T>(matches: number[], selected: Selection<T>, search: string): e.Option.Option<{ completion: string; }> {
  // Note: we are technically assuming here that if matches is 1, selected is the one match
  if (matches.length === 1 && selected.optionEntry.render.startsWith(search)) {
    return e.Option.some({ completion: selected.optionEntry.render.substring(search.length) });
  } else {
    return e.Option.none();
  }
}

function matchingIndices(source: string, toMatch: string): boolean[] {
  const matchingIndices: boolean[] = new Array(source.length).fill(false);
  for (let i = 0; i < source.length; ++i) {
    let curIsMatch = true;
    if (i + toMatch.length > source.length) {
      break;
    }
    for (let j = 0; j < toMatch.length; ++j) {
      if (source.charCodeAt(i + j) !== toMatch.charCodeAt(j)) {
        curIsMatch = false;
        break;
      }
    }
    if (!curIsMatch) {
      continue;
    }
    for (let j = 0; j < toMatch.length; ++j) {
      matchingIndices[i + j] = true;
    }
  }
  return matchingIndices;
}

export function SelectFromList<T>(props: Props<T>): React.ReactNode {
  const { getKey, renderOption } = props;
  const [chosen, setChosen] = React.useState<T | undefined>();
  const [inputFieldFocus, setInputFieldFocus] = React.useState(0);
  const sortedResult = sortedEntries(props.options, getKey, renderOption);
  switch (sortedResult._tag) {
    case "DuplicateKeyError":
      const { one, two } = sortedResult
      props.onError(new DuplicateEntryError({
        one, two
      }));
      return null;
    case "EmptyError":
      props.onError(new NoEntriesError());
      return null;
  }
  const { sorted, first } = sortedResult;
  const [selected, setSelected] = React.useState<Selection<T>>({ optionEntry: first, windex: 0 });
  const [search, setSearch] = React.useState<string>("");
  const totalOptions = sorted.length;
  const totalOptionsChars = totalOptions.toString().length;
  const resolvedRenderIndex = props.renderIndex ?? (
    (optionIndex, matchIndex) => {
      const optionNum = (matchIndex + 1);
      const optionNumStr = optionNum.toString().padStart(totalOptionsChars);
      return `${optionNumStr}. `;
    }
  );
  const resolvedWindowSize = Math.max(1, props.windowSize ?? 10);
  const resolvedRenderSelection = props.renderSelection ?? (selected => selected ? "► " : "  ");

  // Every entry will initially match since the search begins as empty string
  const [matches, setMatches] = React.useState<number[]>(sorted.map((option, index) => index));
  const [curWindow, setCurWindow] = React.useState<{start: number, end: number}>({start: 0, end: resolvedWindowSize - 1});
  
  React.useEffect(() => {
    const sortedResult = sortedEntries(props.options, props.getKey, props.renderOption);
    switch (sortedResult._tag) {
      case "DuplicateKeyError":
        const { one, two } = sortedResult
        props.onError(new DuplicateEntryError({
          one, two
        }));
        return;
      case "EmptyError":
        props.onError(new NoEntriesError());
        return;
    }
    const { sorted } = sortedResult;
    const resolvedWindowSize = Math.max(1, props.windowSize ?? 10);
    updateWindow({
      newOptions: sorted,
      newSearch: search,
      windowSize: resolvedWindowSize,
      currentSelection: selected,
      setMatches,
      setSearch,
      setSelected,
      setCurWindow
    });
  }, [props.windowSize, props.options, props.getKey, props.renderOption]);
  useInput((input, key) => {
    if (key.leftArrow) {
      setInputFieldFocus(Math.max(inputFieldFocus - 1, 0));
    } else if (key.rightArrow) {
      setInputFieldFocus(Math.min(inputFieldFocus + 1, search.length));
    } else if (key.backspace || key.delete) { // TODO: handle forward deletion. On mac osx this doesn't seem to work in the way you'd think
      if (inputFieldFocus === 0) return;
      const newSearch = search.slice(0, inputFieldFocus - 1) + search.slice(inputFieldFocus, search.length);
      setInputFieldFocus(Math.max(inputFieldFocus - 1, 0));
      updateWindow({
        newOptions: sorted,
        newSearch,
        windowSize: resolvedWindowSize,
        currentSelection: selected,
        setMatches,
        setSearch,
        setSelected,
        setCurWindow
      });
    } else if (key.downArrow) {
      const newSelectedIndex = matches[curWindow.start + selected.windex + 1];
      if (newSelectedIndex === undefined) return; // We moved off the end of matches list
      const newSelectedOption = assertElement(sorted, newSelectedIndex);
      const actualWindowSize = curWindow.end - curWindow.start + 1;
      const newWindex =
        selected.windex === actualWindowSize - 1 ?
          selected.windex : selected.windex + 1;
      updateWindow({
        newOptions: sorted,
        newSearch: search,
        windowSize: resolvedWindowSize,
        currentSelection: { optionEntry: newSelectedOption, windex: newWindex },
        setMatches,
        setSearch,
        setSelected,
        setCurWindow
      });
    } else if (key.upArrow) {
      const newSelectedIndex = matches[curWindow.start + selected.windex - 1];
      if (newSelectedIndex === undefined) return; // We moved off the start of matches list
      const newSelectedOption = assertElement(sorted, newSelectedIndex);
      const newWindex =
        selected.windex === 0 ? 0 : selected.windex - 1;
      updateWindow({
        newOptions: sorted,
        newSearch: search,
        windowSize: resolvedWindowSize,
        currentSelection: { optionEntry: newSelectedOption, windex: newWindex },
        setMatches,
        setSearch,
        setSelected,
        setCurWindow
      });
    } else if (key.pageDown) {
      // TODO: move down entire window size
    } else if (key.pageUp) {
      // TODO: move up entire window size
    } else if ((key.tab && e.Option.isSome(shouldMaybeAllowTabComplete(matches, selected, search))) || (key.return && matches.length > 0)) {
      setChosen(selected.optionEntry.option);
      props.onSelected(selected.optionEntry.option);
    } else if (ALPHANUMERIC.test(input)) {
      const newSearch = search.slice(0, inputFieldFocus) + input + search.slice(inputFieldFocus, search.length);
      setInputFieldFocus(inputFieldFocus + 1);
      updateWindow({
        newOptions: sorted,
        newSearch,
        windowSize: resolvedWindowSize,
        currentSelection: selected,
        setMatches,
        setSearch,
        setSelected,
        setCurWindow
      });
    }
  });
  const outsideWindowPrefix = "".padStart(
    resolvedRenderSelection(false).length +
    resolvedRenderIndex(1, 1).length,
    " "
  );
  function row(optionIndex: number, matchIndex: number) {
    const option = assertElement(sorted, optionIndex);
    const isSelected = option.key === selected.optionEntry.key;
    const matchingByIndex = matchingIndices(option.render, search);
    return <>
      <Prefix prefix={props.prefix} />
      <Text color={isSelected ? "yellow" : "gray"}>{resolvedRenderSelection(isSelected)}</Text>
      <Text color={isSelected ? "yellow" : "gray"}>{resolvedRenderIndex(optionIndex, matchIndex)}</Text>
      {matchingByIndex.map((matching, index) => {
        const color: Color =
          isSelected ?
            (matching ? "magentaBright" : "yellow") :
            (matching ? "magentaBright" : "white");
        return <Text color={color} key={index}>
          {option.render.charAt(index)}
        </Text>
      })}
    </>
  }
  const maybeAutocomplete = shouldMaybeAllowTabComplete(matches, selected, search);
  const shouldRenderAutoComplete = e.Option.isSome(maybeAutocomplete);
  const isFirstAutoCompleteCharUnderCursor = inputFieldFocus === search.length;
  return chosen ? null : <Box>
    <Box flexDirection="column">
      <Box>
        <Prefix prefix={props.prefix} isFirstLine={true} />
        <Text color={"white"}>
          {search.slice(0, inputFieldFocus)}
        </Text>
        <Cursor
          key={inputFieldFocus}
          altColor={shouldRenderAutoComplete && isFirstAutoCompleteCharUnderCursor ? {blink: "gray", normal: "gray"} : undefined}
        >
          {search.slice(inputFieldFocus, inputFieldFocus + 1)
            .padEnd(1, (shouldRenderAutoComplete && isFirstAutoCompleteCharUnderCursor) ? maybeAutocomplete.value.completion[0] : " ")}
        </Cursor>
        <Text color={"white"} >
          {search.slice(inputFieldFocus + 1, search.length)}
        </Text>
        {shouldRenderAutoComplete ? <Text color={"gray"}>
          {
            isFirstAutoCompleteCharUnderCursor ? 
              maybeAutocomplete.value.completion.substring(1) :
              maybeAutocomplete.value.completion
          }
        </Text> : null}
      </Box>
      {
        matches.length === 0 ?
          <Box>
            <Prefix prefix={props.prefix} />
            <Text color={"red"}>No matches</Text>
          </Box> :
          <>
            {
              curWindow.start === 0 ? null :
              <>
                <Box>
                  {row(assertElement(matches, 0), 0)}
                </Box>
                <Box>
                  <Prefix prefix={props.prefix} />
                  <Text>{outsideWindowPrefix}</Text>
                  <Text color={"gray"} >
                    ... {curWindow.start - 1}
                  </Text>
                </Box>
              </>
            }
            <Box flexDirection="column">
              {matches.slice(curWindow.start, curWindow.end + 1).map((optionIndex, matchOffset) => {
                return <Box key={optionIndex}>
                  {row(optionIndex, curWindow.start + matchOffset)}
                </Box>
              })}
            </Box>
            {
              curWindow.end === matches.length - 1 ? null :
              <>
                <Box>
                  <Prefix prefix={props.prefix} />
                  <Text>{outsideWindowPrefix}</Text>
                  <Text color={"gray"}>
                    ... { matches.length - 1 - curWindow.end - 1 }
                  </Text>
                </Box>
                <Box>
                  {row(assertElement(matches, matches.length - 1), matches.length - 1)}
                </Box>
              </>
            }
          </>
      }
    </Box>
  </Box>
};
