# 第三方来源与许可证 · 3.1.0

本项目独立源码按 [MIT](LICENSE) 发布，不是 Bilibili Helper 的官方版本。公开包不包含第三方插件、模型、安装程序、浏览器配置或开发依赖。本版已移除模型与语音环境；旧版说明保留在历史版本中。

## JavaScript 开发依赖

运行扩展不需要 npm 依赖。下面是锁定的开发工具及 LinkeDOM 的依赖链，许可证摘要依据锁定依赖的 package metadata；完整许可在各发行包中。开发依赖进入 `node_modules` 后，完整许可位于各包自身目录。

| 组件与版本                                             | 用途              | 已核对的许可证 / 来源                                                                                                                                                    |
| ------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prettier 3.6.2                                         | 源码格式检查      | MIT；[prettier/prettier](https://github.com/prettier/prettier)。                                                                                                         |
| LinkeDOM 0.18.12                                       | 模拟 DOM 测试     | ISC；包内 LICENSE 为准；[WebReflection/linkedom](https://github.com/WebReflection/linkedom)。                                                                            |
| boolbase 1.0.0                                         | LinkeDOM 间接依赖 | ISC；[fb55/boolbase](https://github.com/fb55/boolbase)。                                                                                                                 |
| css-select 5.2.2、css-what 6.2.2、nth-check 2.1.1      | 选择器支持        | BSD-2-Clause；[css-select](https://github.com/fb55/css-select)、[css-what](https://github.com/fb55/css-what)、[nth-check](https://github.com/fb55/nth-check)。           |
| cssom 0.5.0                                            | CSS 对象模型      | MIT；[NV/CSSOM](https://github.com/NV/CSSOM)。                                                                                                                           |
| dom-serializer 2.0.0                                   | DOM 序列化        | MIT；[cheeriojs/dom-serializer](https://github.com/cheeriojs/dom-serializer)。                                                                                           |
| domelementtype 2.3.0、domhandler 5.0.3、domutils 3.2.2 | DOM 工具          | BSD-2-Clause；[domelementtype](https://github.com/fb55/domelementtype)、[domhandler](https://github.com/fb55/domhandler)、[domutils](https://github.com/fb55/domutils)。 |
| entities 4.5.0 与 7.0.1                                | HTML 实体         | BSD-2-Clause；[fb55/entities](https://github.com/fb55/entities)。                                                                                                        |
| html-escaper 3.0.3、htmlparser2 10.1.0                 | HTML 转义与解析   | MIT；[html-escaper](https://github.com/WebReflection/html-escaper)、[htmlparser2](https://github.com/fb55/htmlparser2)。                                                 |
| uhyphen 0.2.0                                          | 名称转换          | ISC；[WebReflection/uhyphen](https://github.com/WebReflection/uhyphen)。                                                                                                 |

Prettier 自身可能包含内嵌第三方代码，其包内完整 LICENSE 应一并保留。上表不是这些工具的开发依赖树，也不表示本扩展在浏览器里加载了它们。

## 浏览器与站点

Chrome 为用户本机浏览器，遵循其发行条款。B站视频、封面、评论与图片属于相应权利人，能够访问不代表取得再分发许可。接口可用性仍受站点与账号权限限制。本项目不绕过会员、付费或区域限制。

B站、Chrome 等名称分别归相应权利人，提及不表示合作或背书。图标为项目自行绘制的 SVG 与对应 PNG，说明见 LOGO.md。
