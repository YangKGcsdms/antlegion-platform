Tailwind CSS 常用模式速查。直接复制到 HTML 里改内容就行。

## 页面布局

```html
<!-- 居中容器 -->
<div class="max-w-6xl mx-auto px-4">

<!-- 两端对齐行 -->
<div class="flex items-center justify-between">

<!-- 左右分栏 -->
<div class="grid grid-cols-3 gap-6">
  <div class="col-span-2">主内容</div>
  <div>侧边栏</div>
</div>

<!-- 统计卡片行 -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
  <div class="bg-white rounded-lg shadow p-5">
    <p class="text-sm text-gray-500">总数</p>
    <p class="text-2xl font-bold text-gray-800">42</p>
  </div>
</div>
```

## 列表页完整模板

```html
<!-- 标题 + 操作 -->
<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold text-gray-800">待办事项</h1>
  <button class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2">
    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
    </svg>
    新建
  </button>
</div>

<!-- 筛选栏 -->
<div class="flex gap-3 mb-4">
  <select class="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
    <option>全部状态</option>
    <option>待处理</option>
    <option>进行中</option>
    <option>已完成</option>
  </select>
  <input placeholder="搜索..." class="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
</div>

<!-- 数据表格 -->
<div class="bg-white rounded-lg shadow overflow-hidden">
  <table class="w-full">
    <thead class="bg-gray-50 border-b border-gray-200">
      <tr>
        <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">标题</th>
        <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
        <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">优先级</th>
        <th class="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
      </tr>
    </thead>
    <tbody>
      <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
        <td class="px-4 py-3 font-medium text-gray-800">示例标题</td>
        <td class="px-4 py-3">
          <span class="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">待处理</span>
        </td>
        <td class="px-4 py-3 text-sm text-red-600 font-medium">高</td>
        <td class="px-4 py-3 text-right">
          <button class="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded">编辑</button>
          <button class="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded">删除</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>

<!-- 分页 -->
<div class="flex items-center justify-between mt-4 text-sm text-gray-500">
  <span>共 42 条</span>
  <div class="flex gap-1">
    <button class="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">&lt;</button>
    <button class="px-3 py-1 rounded bg-blue-600 text-white">1</button>
    <button class="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">2</button>
    <button class="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">3</button>
    <button class="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50">&gt;</button>
  </div>
</div>
```

## Modal 模板

```html
<!-- ====== COMPONENT: Modal ====== -->
<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div class="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
      <h2 class="text-lg font-semibold text-gray-800">标题</h2>
      <button class="text-gray-400 hover:text-gray-600">&times;</button>
    </div>
    <!-- Body -->
    <div class="px-6 py-4 space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          标题 <span class="text-red-500">*</span>
        </label>
        <input class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
    </div>
    <!-- Footer -->
    <div class="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
      <button class="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">取消</button>
      <button class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">确定</button>
    </div>
  </div>
</div>
<!-- ====== END: Modal ====== -->
```

## Toast 模板

```html
<!-- ====== COMPONENT: Toast ====== -->
<!-- 成功 -->
<div class="fixed top-4 right-4 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50">
  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
  <span>操作成功</span>
</div>
<!-- 错误 -->
<div class="fixed top-4 right-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50">
  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
  <span>操作失败</span>
</div>
<!-- ====== END: Toast ====== -->
```

## 空状态

```html
<div class="bg-white rounded-lg shadow p-12 text-center">
  <svg class="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
  </svg>
  <p class="text-gray-500 mb-4">暂无数据</p>
  <button class="text-blue-600 hover:text-blue-700 font-medium">创建第一个</button>
</div>
```
