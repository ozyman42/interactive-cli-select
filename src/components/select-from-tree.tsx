import React from "react";
import * as e from "effect";
import { Box, Text, render } from "ink";
import { SelectFromList, PossibleErrors } from "./select-from-list";
import { magenta } from "ansicolor";

export class FetchOptionsError<E> extends e.Data.TaggedError("FetchOptionsError")<{cause: E}> { }
export class SelectOptionError extends e.Data.TaggedError("SelectOptionError")<{cause: PossibleErrors<string>}> { }

export type SelectFromTreeProps<E> = {
  root: string;
  getOptionKey: (nodes: string[], option: string) => string;
  renderOption: (nodes: string[], option: string) => string;
  renderTree?: (root: string, renderSelection: (selection: string) => string, nodes: string[]) => string;
  getOptions: (nodes: string[]) => e.Effect.Effect<string[], E>;
  onError: (error: SelectOptionError | FetchOptionsError<E>) => void;
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

export function defaultRenderTree<T>(root: string, renderSelection: (selection: string) => string, nodes: string[]) {
  let rendered = root;
  const totalLevels = nodes.length;
  const lastLevelPrefix = "╚══ "
  const intermediateLevelPrefix = "╚╦═ "
  const prefixToAddPerLevel = " ";
  let level = 0;
  for (const node of [...nodes, ""]) {
    let prefix = new Array(level).fill(prefixToAddPerLevel).join("");
    if (level === totalLevels) {
      prefix += lastLevelPrefix;
      rendered += "\n" + prefix;
    } else {
      prefix += intermediateLevelPrefix;
      rendered += "\n" + prefix + magenta(renderSelection(node));
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
  const [nodes, setNodes] = React.useState<string[]>([]);
  const [curOptions, setCurOptions] = React.useState<e.Option.Option<string[]>>(e.Option.none());
  const resolvedRenderTree = props.renderTree ?? defaultRenderTree;
  const treeText = resolvedRenderTree(props.root, selection => props.renderOption(nodes, selection), nodes);
  const lines = treeText.split("\n");
  const lastLine = lines.pop();
  const fetchingOptions = e.Option.isNone(curOptions);
  function fetchOptions(fromNodes: string[]) {
    setNodes(fromNodes);
    setCurOptions(e.Option.none());
    e.Effect.runPromise(
      e.pipe(
        props.getOptions(fromNodes),
        e.Effect.map(options => {
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
            getKey={opt => props.getOptionKey(nodes, opt)}
            renderOption={opt => props.renderOption(nodes, opt)}
            onError={e => {
              setHadError(true);
              props.onError(new SelectOptionError({ cause: e }));
            }}
            onSelected={node => {
              const newNodes = [...nodes, node];
              fetchOptions(newNodes);
            }}
          /> : null
        )
    }
  </Box>
}
