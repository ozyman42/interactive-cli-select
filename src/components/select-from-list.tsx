import React from "react";
import { Box, Newline, Text, useInput } from "ink";
import * as e from "effect";

export class DuplicateEntryError<T> extends e.Data.TaggedError("DuplicateEntryError")<{ one: T, two: T }> { }
export class NoEntriesError extends e.Data.TaggedError("NoEntriesError")<{}> { }

export type PossibleErrors<T> = 
  DuplicateEntryError<T> |
  NoEntriesError

export interface Props<T> {
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

export function SelectFromList<T>(props: Props<T>): React.ReactNode {
  const options: Record<string, T> = {};
  for (const option of props.options) {
    const key = props.getKey(option);
    const existing = options[key];
    if (existing !== undefined) {
      props.onError(new DuplicateEntryError({ one: existing, two: option }));
      return null;
    }
    options[key] = option;
  }
  const sorted = Array.from(Object.keys(options)).sort();
  // No non-empty arrays allowed
  const firstOption = sorted[0];
  if (firstOption === undefined) {
    props.onError(new NoEntriesError());
    return null;
  }
  // Setup
  const [chosen, setChosen] = React.useState<T | undefined>();
  const [inputFieldFocus, setInputFieldFocus] = React.useState(0);
  const [selected, setSelected] = React.useState<{ option: string; windex: number; }>({ option: firstOption, windex: 0 });
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
  function updateWindow(windowSize: number, newSearch: string, newOptions: Set<string>, currentSelection: { option: string; windex: number; }) {
    const sorted = Array.from(new Set(newOptions)).sort();
    const indexOfSelection = sorted.indexOf(currentSelection.option);
    const matches = sorted
      .map((option, index) => [index, option] as const)
      .filter(([index, option]) => option.includes(newSearch));
    const matchesSet = new Set(matches.map(([index, option]) => option));
    function closestOption(to: string): number {
      // Walk through sorted until we find place that current selection would be
      for (const [index, cur] of Object.entries(sorted)) {
        if (to < cur) {
          const curIndex = parseInt(index);
          if (curIndex === 0) return curIndex;
          // Given two possible indices we need to figure out which of the two is closest
          const prevIndex = curIndex - 1;
          const prev = sorted[prevIndex]!;
          const curDist = alphabeticalDistance(cur, to);
          const prevDist = alphabeticalDistance(prev, to);
          if (curDist < prevDist) return curIndex;
          else return prevIndex;
        }
      }
      return sorted.length - 1;
    }
    function closestMatch(fromIndex: number): e.Option.Option<number> {
      if (matchesSet.size === 0) {
        return e.Option.none();
      }
      const from = assertElement(sorted, fromIndex);
      if (matchesSet.has(from)) {
        return e.Option.some(fromIndex);
      }
      // We search in both directions until we find a match.
      let high = fromIndex + 1;
      let low = fromIndex - 1;
      do {
        const curHigh = sorted[high];
        const curLow = sorted[low];
        const highMatches = curHigh !== undefined && matchesSet.has(curHigh);
        const lowMatches = curLow !== undefined && matchesSet.has(curLow);
        if (lowMatches && highMatches) {
          const lowDist = alphabeticalDistance(curLow, from);
          const highDist = alphabeticalDistance(curHigh, from);
          if (lowDist < highDist) return e.Option.some(low);
          else return e.Option.some(high);
        } else if (lowMatches) {
          return e.Option.some(low);
        } else if (highMatches) {
          return e.Option.some(high);
        } else {
          if (low >= 0) low--;
          if (high < sorted.length) high++;
        }
      } while (low >= 0 || high < sorted.length);
      throw new Error("Not possible for us to walk through entire options list without finding match");
    }
    const newSelection =
      closestMatch(
        indexOfSelection === -1 ?
          closestOption(currentSelection.option) :
          indexOfSelection
      );
    if (e.Option.isNone(newSelection)) {
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
    const newSelectedIndex = newSelection.value;
    const newSelectedOption = assertElement(sorted, newSelectedIndex);
    const matchIndex = matches.map(([index, option]) => option).indexOf(newSelectedOption);
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
    setSelected({ option: newSelectedOption, windex: finalWindex });
    assertElement(matches, matchIndex);
    setCurWindow({
      start: finalWindowStart,
      end: finalWindowEnd
    });
  }
  React.useEffect(() => {
    updateWindow(resolvedWindowSize, search, new Set(sorted), selected);
  }, [props.windowSize, props.options]);
  useInput((input, key) => {
    if (key.leftArrow) {
      setInputFieldFocus(Math.max(inputFieldFocus - 1, 0));
    } else if (key.rightArrow) {
      setInputFieldFocus(Math.min(inputFieldFocus + 1, search.length));
    } else if (key.backspace || key.delete) { // TODO: handle forward deletion. On mac osx this doesn't seem to work in the way you'd think
      if (inputFieldFocus === 0) return;
      const newSearch = search.slice(0, inputFieldFocus - 1) + search.slice(inputFieldFocus, search.length);
      setInputFieldFocus(Math.max(inputFieldFocus - 1, 0));
      updateWindow(resolvedWindowSize, newSearch, new Set(sorted), selected);
    } else if (key.downArrow) {
      const newSelectedIndex = matches[curWindow.start + selected.windex + 1];
      if (newSelectedIndex === undefined) return; // We moved off the end of matches list
      const newSelectedOption = assertElement(sorted, newSelectedIndex);
      const actualWindowSize = curWindow.end - curWindow.start + 1;
      const newWindex =
        selected.windex === actualWindowSize - 1 ?
        selected.windex : selected.windex + 1;
      updateWindow(resolvedWindowSize, search, new Set(sorted), { option: newSelectedOption, windex: newWindex });
    } else if (key.upArrow) {
      const newSelectedIndex = matches[curWindow.start + selected.windex - 1];
      if (newSelectedIndex === undefined) return; // We moved off the start of matches list
      const newSelectedOption = assertElement(sorted, newSelectedIndex);
      const newWindex =
        selected.windex === 0 ? 0 : selected.windex - 1;
      updateWindow(resolvedWindowSize, search, new Set(sorted), { option: newSelectedOption, windex: newWindex });
    } else if (key.pageDown) {
      // TODO: move down entire window size
    } else if (key.pageUp) {
      // TODO: move up entire window size
    } else if (key.tab) {
      // TODO: tab completion?
    } else if (ALPHANUMERIC.test(input)) {
      const newSearch = search.slice(0, inputFieldFocus) + input + search.slice(inputFieldFocus, search.length);
      setInputFieldFocus(inputFieldFocus + 1);
      updateWindow(resolvedWindowSize, newSearch, new Set(sorted), selected);
    } else if (key.return) {
      if (matches.length > 0) {
        const selectedOption = options[selected.option];
        if (selectedOption) {
          setChosen(selectedOption);
          props.onSelected(selectedOption);
        } else {
          console.log(`${matches.length} matches but selection is undefined`);
        }
      }
    }
  });
  const outsideWindowPrefix = "".padStart(
    resolvedRenderSelection(false).length +
    resolvedRenderIndex(1, 1).length,
    " "
  );
  function row(optionIndex: number, matchIndex: number) {
    const option = assertElement(sorted, optionIndex);
    const isSelected = option === selected.option;
    const optionT = options[option];
    if (optionT === undefined) {
      console.log(`No matching record for option "${option}"`);
      return null;
    }
    return <>
      <Text color={isSelected ? "yellow" : "gray"}>{resolvedRenderSelection(isSelected)}</Text>
      <Text color={isSelected ? "yellow" : "gray"}>{resolvedRenderIndex(optionIndex, matchIndex)}</Text>
      <Text color={isSelected ? "yellowBright" : "white"}>{props.renderOption(optionT)}</Text>
    </>
  }
  return chosen ? null : <Box flexDirection="column">
    <Box>
      <Text color={"white"}>
        {search.slice(0, inputFieldFocus)}
      </Text>
      <Text backgroundColor={"white"} color={"black"}>
        {search.slice(inputFieldFocus, inputFieldFocus + 1).padEnd(1, " ")}
      </Text>
      <Text color={"white"} >
        {search.slice(inputFieldFocus + 1, search.length)}
      </Text>
    </Box>
    {
      matches.length === 0 ?
        <Box>
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
};
