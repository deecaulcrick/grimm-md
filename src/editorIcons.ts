import {
  AppWindow,
  Code,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Plus,
  Table,
  TextQuote,
  Type,
  createElement,
  type IconNode,
} from "lucide";

// The editor takes its icons as SVG markup.
const svg = (node: IconNode) => createElement(node, { "stroke-width": 1.5, class: "lucide" }).outerHTML;

/** Lucide replacements for the insert menu and block handle icons. */
export const blockEditIcons = {
  handleAddIcon: svg(Plus),
  handleDragIcon: svg(GripVertical),
  textGroup: {
    text: { icon: svg(Type) },
    h1: { icon: svg(Heading1) },
    h2: { icon: svg(Heading2) },
    h3: { icon: svg(Heading3) },
    h4: { icon: svg(Heading4) },
    h5: { icon: svg(Heading5) },
    h6: { icon: svg(Heading6) },
    quote: { icon: svg(TextQuote) },
    divider: { icon: svg(Minus) },
  },
  listGroup: {
    bulletList: { icon: svg(List) },
    orderedList: { icon: svg(ListOrdered) },
    taskList: { icon: svg(ListTodo) },
  },
  advancedGroup: {
    image: { icon: svg(Image) },
    codeBlock: { icon: svg(Code) },
    table: { icon: svg(Table) },
  },
};

export const embedIcon = svg(AppWindow);
