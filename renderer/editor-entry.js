// Tiptap 富文本编辑器打包入口（由 esbuild 打包成 vendor/tiptap.bundle.js）
// 作用：初始化编辑器，并支持粘贴时保留内联样式（如 VSCode 复制的带颜色代码）
import { Editor, Mark, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlock from '@tiptap/extension-code-block';

// 关键修复：Tiptap 的 CodeBlock 扩展自带一个「VSCode 粘贴」处理器，
// 它检测到剪贴板里的 vscode-editor-data 后，会用 text/plain 建一个纯文本代码块，
// 把带颜色的 text/html 直接丢掉——这就是 VSCode 代码粘贴后变黑的原因。
// 这里重写 addProseMirrorPlugins，去掉这个处理器，让 VSCode 粘贴走正常 HTML 解析，
// 从而由下面的 inlineStyle mark 保留颜色。
const CodeBlockWithoutVSCodeHandler = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [];
  }
});

// 只提取 color，丢弃 background-color / font-family / white-space 等样式。
// 否则 VSCode 主题的深色背景（如 One Dark 的 rgb(40,44,52)）会被一并保留，
// 在浅色笔记里渲染成黑块。
function extractColor(style) {
  if (!style) return null;
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    if (decl.slice(0, i).trim().toLowerCase() !== 'color') continue;
    const val = decl.slice(i + 1).trim();
    return val || null;
  }
  return null;
}

// 自定义 mark：捕获粘贴进来的 <span style="...">，只保留 color 内联颜色
const InlineStyle = Mark.create({
  name: 'inlineStyle',
  inclusive: false,
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => extractColor(el.getAttribute('style')),
        renderHTML: (attrs) => (attrs.color ? { style: `color: ${attrs.color}` } : {})
      }
    };
  },
  parseHTML() {
    return [{ tag: 'span[style]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  }
});

// 暴露全局工厂：element 为容器 div；opts.placeholder 为占位文案，opts.onUpdate 在内容变化时回调（用于自动保存）
window.createNoteEditor = function (element, opts) {
  const { placeholder = '', onUpdate } = opts || {};
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockWithoutVSCodeHandler,
      InlineStyle,
      Placeholder.configure({ placeholder })
    ],
    content: '',
    editorProps: {
      attributes: { class: 'ProseMirror' }
    },
    onUpdate
  });
};
