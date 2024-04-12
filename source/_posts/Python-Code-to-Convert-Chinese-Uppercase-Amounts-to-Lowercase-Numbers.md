---
title: Python 转换金额数字大写为数字小写
date: 2020-11-02 22:11:33
tags:
---

通过编写Python代码将中文大写金额转换为小写数字

<!-- more -->

py浮点型运算有一个魔法，例如1.01*3.0=3.0300000000000002
所以全部转为整数运算，最后除100返回

```python
def toInt(value):
    isum = 0
    nums = {'零': 0, '壹': 1, '贰':2, '叁': 3, '肆': 4, '伍': 5, '陆': 6, '柒': 7, '捌': 8, '玖':9}
    dw = {'拾': 3, '元': 2, '佰': 4, '仟': 5, '万' : 6, '角': 1, '分': 0}
    index = 0
    while index < len(value):
        if value[index] != '零':
            if (value[index] == '拾'):
                isum += 1000;
                index += 1
            elif value[index] in nums :
                isum += nums[value[index]] * pow(10, dw[value[index + 1]])
                index += 2
            else:
                index +=1
        else:
            index += 1
    return round(isum, 2) / 100
```
