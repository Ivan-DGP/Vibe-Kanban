export interface CounterState {
  count: number;
  history: number[];
}

export type CounterAction =
  | { type: "INC" }
  | { type: "DEC" }
  | { type: "SET"; value: number }
  | { type: "RESET" };

export const initialState: CounterState = { count: 0, history: [] };

export function counterReducer(state: CounterState, action: CounterAction): CounterState {
  switch (action.type) {
    case "INC":
      return { count: state.count + 1, history: [...state.history, state.count + 1] };
    case "DEC":
      return { count: state.count - 1, history: [...state.history, state.count - 1] };
    case "SET":
      return { count: action.value, history: [...state.history, action.value] };
    case "RESET":
      return { count: state.count, history: state.history };
    default:
      return state;
  }
}
