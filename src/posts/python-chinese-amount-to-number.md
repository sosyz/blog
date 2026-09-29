---
title: "Python 转换金额数字大写为数字小写"
description: "用 Python 把中文大写金额转换成小写数字，全程用整数运算来避开浮点误差。"
type: 随想
topic: 早年笔记
tags: [Python, 金额转换]
pubDate: "2020-11-02"
updatedDate: "2026-09-29"
---

通过编写 Python 代码将中文大写金额转换为小写数字

## 思路

py 浮点型运算有一个魔法，例如 `1.01*3.0=3.0300000000000002`，所以全部转为整数运算，最后除 100 返回

数字先记下来，遇到「拾」「佰」「仟」乘到当前一节里，遇到「万」「亿」「元」把这一节按对应的倍数结算，「角」「分」直接按分累加。

## 代码

> 更正（2026-09-29）：最初的版本按「数字后面紧跟一个单位」来算，数字在末尾（如「壹佰零伍」）时会越界报错，带「万」的金额也算错了（「拾万元」算成 10，「壹拾贰万叁仟肆佰伍拾陆元柒角捌分」算成 23466.78）。下面是改过的版本。

```python
def toInt(value):
    nums = {'零': 0, '壹': 1, '贰': 2, '叁': 3, '肆': 4, '伍': 5, '陆': 6, '柒': 7, '捌': 8, '玖': 9}
    units = {'拾': 10, '佰': 100, '仟': 1000}   # 一节（万以内）里的倍数
    sections = {'亿': 10 ** 10, '万': 10 ** 6, '元': 100}   # 以分为单位的倍数
    cents = {'角': 10, '分': 1}
    isum = 0      # 已经结算的金额（分）
    section = 0   # 当前一节的值，遇到万、亿、元时结算
    num = 0       # 还没遇到单位的数字
    for ch in value:
        if ch in nums:
            num = nums[ch]
        elif ch in units:
            section += (num or 1) * units[ch]   # “拾元”前面没有数字，按壹算
            num = 0
        elif ch in sections:
            isum += (section + num) * sections[ch]
            section = num = 0
        elif ch in cents:
            isum += num * cents[ch]
            num = 0
        # 其他字（如“整”）跳过
    isum += (section + num) * 100   # 末尾没有单位的数字按元算
    return isum / 100
```

## 示例

```python
print(toInt('壹拾贰万叁仟肆佰伍拾陆元柒角捌分'))  # 123456.78
print(toInt('拾万元'))  # 100000.0
print(toInt('叁元零叁分'))  # 3.03
print(toInt('壹佰零伍'))  # 105.0
```
