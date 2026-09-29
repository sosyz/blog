---
title: "easySQLite 使用笔记"
description: "补充 easySQLite 文档没写清的用法：中文路径下打开数据库失败的处理，以及读取字段值和主键。"
type: 踩坑
topic: 早年笔记
tags: [SQLite, C/C++, easySQLite]
pubDate: "2019-02-09"
---

由于在开发酷Q 机器人时需要用到 SQLite，所以找到了 easySQLite，这是一个简单的 SQLite 封装库，使用起来比较方便，但是文档不够详细，所以在这里做一些补充

> easySQLite 地址：<https://code.google.com/archive/p/easysqlite/>

## 打开数据库

使用时提示“Database::open: unable to open database file”，可能是因为 fileName 编码不正确，因为此处要求 UTF-8 编码，尝试在前头加上 u8，例如：`db.open(u8"D:/中文文件夹名/test.db");`，或对 fileName 进行转码。下面的 `GbkToUtf8` 用的是 Windows API（`MultiByteToWideChar`、`WideCharToMultiByte`，需要 `#include <windows.h>`），只能在 Windows 上用

```cpp
//gbk转UTF-8
string GbkToUtf8(const std::string& strGbk)//传入的strGbk是GBK编码
{
    //gbk转unicode
    int len = MultiByteToWideChar(CP_ACP, 0, strGbk.c_str(), -1, NULL, 0);
    wchar_t *strUnicode = new wchar_t[len];
    wmemset(strUnicode, 0, len);
    MultiByteToWideChar(CP_ACP, 0, strGbk.c_str(), -1, strUnicode, len);
    //unicode转UTF-8
    len = WideCharToMultiByte(CP_UTF8, 0, strUnicode, -1, NULL, 0, NULL, NULL);
    char * strUtf8 = new char[len];
    WideCharToMultiByte(CP_UTF8, 0, strUnicode, -1, strUtf8, len, NULL, NULL);
    std::string strTemp(strUtf8);//此时的strTemp是UTF-8编码
    delete[]strUnicode;
    delete[]strUtf8;
    strUnicode = NULL;
    strUtf8 = NULL;
    return strTemp;
}
```

## 取字段值

```cpp
//load all records
tbPerson.open();

//list loaded records
for (int index = 0; index < tbPerson.recordCount(); index++){
    if (Record* record = tbPerson.getRecord(index)) {
        Value* value = record->getValue("value");  //取value字段的值
        Value* value2 = record->getKeyIdValue();  //取主键ID
    }
}
```
