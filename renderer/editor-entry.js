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

// 自定义 mark：捕获粘贴进来的 <span style="...">，完整保留 color/background-color 等内联样式
const InlineStyle = Mark.create({
  name: 'inlineStyle',
  inclusive: false,
  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: (el) => el.getAttribute('style') || null,
        renderHTML: (attrs) => (attrs.style ? { style: attrs.style } : {})
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

// 暴露全局工厂：element 为容器 div，onUpdate 在内容变化时回调（用于自动保存）
window.createNoteEditor = function (element, onUpdate) {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockWithoutVSCodeHandler,
      InlineStyle,
      Placeholder.configure({ placeholder: '在这里写 Markdown...' })
    ],
    content: '',
    editorProps: {
      attributes: { class: 'ProseMirror' }
    },
    onUpdate
  });
};
