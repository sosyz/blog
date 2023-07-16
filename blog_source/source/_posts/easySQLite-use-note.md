---
title: easySQLite使用笔记
date: 2019-02-09  23:34:58
tags: easySQLite
updated: 2019-02-09  23:34:58
---

> easySQLite地址：<https://code.google.com/archive/p/easysqlite/>

由于需要用到SQLite，经过一番兜兜转转，看到了easySQLite，下载下来，还不错，就是有些地方说明不够详细，以此做补充

## 打开数据库

使用时提示 "Database::open: unable to open database file"，可能是因为fileName编码不正确，因为此处要求ut8编码，尝试在前头加上 u8，例如：`db.open(u8"D:/中文文件夹名/test.db");`, 或对fileName进行转码

```c++
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

```c++
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
