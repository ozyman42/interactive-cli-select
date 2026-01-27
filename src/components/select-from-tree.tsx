import React from "react";
import * as e from "effect";
import { Box, Text, render } from "ink";
import { SelectFromList, PossibleErrors } from "./select-from-list";
import * as ansicolor from "ansicolor";
import { Color } from "../common";

export class FetchOptionsError<E> extends e.Data.TaggedError("FetchOptionsError")<{cause: E}> { }
export class SelectOptionError extends e.Data.TaggedError("SelectOptionError")<{cause: PossibleErrors<string>}> { }

export type SelectFromTreeProps<E> = {
  root: string;
  getOptionKey: (priorChoices: string[], option: string) => string;
  renderOption: (priorChoices: string[], option: string) => string;
  renderTree?: (root: string, renderChoice: (choice: string) => string, choices: string[]) => string;
  getOptions: (priorChoices: string[]) => e.Effect.Effect<string[], E>;
  onError: (error: SelectOptionError | FetchOptionsError<E>) => void;
  choiceColor?: Color;
  selectedColor?: Color;
  matchColor?: Color;
}

const LoadingCircle: React.FC = () => {
  function fromIdx(curIdx: number) {
    return ['◴', '◷', '◶', '◵'][curIdx]!;
  }
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    const intervalId = setInterval(() => {
      setIdx(prev => (prev + 1) % 4);
    }, 333);
    return () => clearInterval(intervalId);
  }, []);
  return <Text>{fromIdx(idx)}</Text>
}

function toAnsicolorFn(color: Color): (text: string) => string {
  switch (color) {
    case Color.none:
      return text => text;
    case Color.gray:
      return ansicolor.lightGray;
    case Color.blueBright:
      return ansicolor.lightBlue;
    case Color.cyanBright:
      return ansicolor.lightCyan;
    case Color.greenBright:
      return ansicolor.lightGreen;
    case Color.magentaBright:
      return ansicolor.lightMagenta;
    case Color.redBright:
      return ansicolor.lightRed;
    case Color.whiteBright:
      return ansicolor.white;
    case Color.yellowBright:
      return ansicolor.lightYellow;
    default:
      return ansicolor[color];
  }
}

export function defaultRenderTree<T>(root: string, renderChoice: (choice: string) => string, priorChoices: string[], choiceColor: Color) {
  let rendered = `╦═ ${root}`;
  const totalLevels = priorChoices.length;
  const lastLevelPrefix = "╚══ "
  const intermediateLevelPrefix = "╚╦═ "
  const prefixToAddPerLevel = " ";
  let level = 0;
  for (const priorChoice of [...priorChoices, ""]) {
    let prefix = new Array(level).fill(prefixToAddPerLevel).join("");
    if (level === totalLevels) {
      prefix += lastLevelPrefix;
      rendered += "\n" + prefix;
    } else {
      prefix += intermediateLevelPrefix;
      rendered += "\n" + prefix + toAnsicolorFn(choiceColor)(renderChoice(priorChoice));
    }
    level += 1;
  }
  return rendered;
}

export function SelectFromTree<E>(props: SelectFromTreeProps<E>): React.ReactNode {
  const [hadError, setHadError] = React.useState(false);
  if (hadError) {
    return null;
  }
  const [choices, setChoices] = React.useState<string[]>([]);
  const [curOptions, setCurOptions] = React.useState<e.Option.Option<string[]>>(e.Option.none());
  const resolvedChoiceColor = props.choiceColor ?? Color.magentaBright;
  const resolvedRenderTree = props.renderTree ?? defaultRenderTree;
  const treeText = resolvedRenderTree(props.root, selection => props.renderOption(choices, selection), choices, resolvedChoiceColor);
  const lines = treeText.split("\n");
  const lastLine = lines.pop();
  const fetchingOptions = e.Option.isNone(curOptions);
  const [firstOptionsCache, setFirstOptionsCache] = React.useState<e.Option.Option<string[]>>(e.Option.none());
  const [optionsByLastChoiceCache, setOptionsByLastChoiceCache] = React.useState<Record<string, string[]>>({});
  function fetchOptions(priorChoices: string[]) {
    setChoices(priorChoices);
    const lastChoice = priorChoices[priorChoices.length - 1];
    if (lastChoice === undefined) {
      if (e.Option.isSome(firstOptionsCache)) {
        setCurOptions(firstOptionsCache);
        return;
      }
    } else {
      const maybeCached = optionsByLastChoiceCache[lastChoice];
      if (maybeCached !== undefined) {
        setCurOptions(e.Option.some(maybeCached));
        return;
      }
    }
    setCurOptions(e.Option.none());
    e.Effect.runPromise(
      e.pipe(
        props.getOptions(priorChoices),
        e.Effect.map(options => {
          if (lastChoice === undefined) {
            setFirstOptionsCache(e.Option.some(options));
          } else {
            setOptionsByLastChoiceCache({ ...optionsByLastChoiceCache, [lastChoice]: options });
          }
          setCurOptions(e.Option.some(options));
        }),
        e.Effect.catchAll(e.Effect.fn(function* (e) {
          setHadError(true);
          props.onError(new FetchOptionsError({ cause: e }));
        }))
      )
    );
  }
  React.useEffect(() => {
    fetchOptions([]);
  }, []);
  return <Box flexDirection="column">
    {lines.map((line, index) => <Box key={index}>
      <Text key={index}>
        {line}
      </Text>
    </Box>)}
    {lastLine === undefined ?
      null :
      fetchingOptions ?
        <Box>
          <Text>{lastLine}</Text>
          <LoadingCircle />
        </Box> :
        (curOptions.value.length > 0 ?
          <SelectFromList
            prefix={{ firstLineOnly: lastLine, allLines: "" }}
            options={curOptions.value}
            getKey={opt => props.getOptionKey(choices, opt)}
            renderOption={opt => props.renderOption(choices, opt)}
            onError={e => {
              setHadError(true);
              props.onError(new SelectOptionError({ cause: e }));
            }}
            onSelected={choice => {
              const newChoices = [...choices, choice];
              fetchOptions(newChoices);
            }}
            onEmptySearchDelete={() => {
              const newChoices = [...choices];
              const oldLength = newChoices.length;
              if (oldLength === 0) return;
              newChoices.pop();
              fetchOptions(newChoices);
            }}
            selectedColor={props.selectedColor}
            matchColor={props.matchColor ?? resolvedChoiceColor}
          /> : null
        )
    }
  </Box>
}
