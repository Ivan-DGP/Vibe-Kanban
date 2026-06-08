export interface Item {
  id: number;
  name: string;
  qty: number;
}

export interface Cart {
  items: Item[];
  total: number;
}
