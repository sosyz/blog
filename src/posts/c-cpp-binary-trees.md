---
title: "C/C++ 二叉树"
description: "用 C/C++ 实现二叉树的创建、带深度的遍历输出与查找，并记下查找二叉树的特性。"
type: 踩坑
topic: 早年笔记
tags: [C/C++, 数据结构]
pubDate: "2020-11-19"
updatedDate: "2026-09-29"
---

对于数据结构初学者，二叉树是一个很好的练习题目，这里记录一下二叉树的一些操作。

## 查找二叉树的特性

查找二叉树有一个特性：

> 对于所有的节点，都满足左子树上的所有节点都比自己的小，而右子树上的所有节点都比自己大
> ————《挑战程序设计竞赛第二版》P78

## 代码

按先序输入建树（`#` 表示空节点），然后带深度输出每个节点，最后查找一个值。

```cpp
#include <iostream>
#include <stdlib.h>

using namespace std;

typedef struct TreeNode
{
    int data;
    struct TreeNode *LT, *RT;
}TreeNode, *TreeList;

//创建一个叶子节点
TreeNode* creatTree(int pData){
    TreeNode *tree = (TreeNode*)malloc(sizeof(TreeNode));
    tree->data = pData;
    tree->LT = NULL;
    tree->RT = NULL;
    return tree;
}

int addLeaf(TreeList &node, int deep){
    //传参需要注意，二叉树是指针类型的，节点本身就是一个指针：*node。所以需要二级指针才能改变二叉树的内容
    //TreeNode *node = NULL;
    char input;
    cin >> input;
    if(input != '#'){
        node = creatTree((int)input);
        addLeaf(node->LT, deep + 1);
        addLeaf(node->RT, deep + 1);
    } else{
        node = NULL;
    }
    return 1;
}

int treeInfo(TreeNode *tree, int deep){
    cout << "deep: " << deep << ", data: " << (char)tree->data << endl;
    if (tree->LT != NULL) treeInfo(tree->LT, deep + 1);
    if (tree->RT != NULL) treeInfo(tree->RT, deep + 1);
    return 0;
}

TreeNode *findValue(TreeNode *node, int value){
    //这棵树是按输入顺序建的，不是查找二叉树，所以左右子树都要找
    if (node == NULL) return NULL;
    if (node->data == value) {
        cout << "ok, find it." << endl;
        return node;
    }
    TreeNode *found = findValue(node->LT, value);
    if (found != NULL) return found;
    return findValue(node->RT, value);
}

int main(){
    char data;
    TreeList tree, temp;
    addLeaf(tree, 0);
    cout << "start out info:" << endl;
    treeInfo(tree, 0);
    cout << "end out info" << endl;
    cout << "input a num to find: ";
    cin >> data;
    temp = findValue(tree, data);
    if (!temp) cout << "no find it." <<endl;
    else cout << "find in " << temp << ", data: " << (char)temp->data << endl; //temp 就是节点地址，&temp 是局部变量 temp 自己的地址

}
```

## 更正

- `findValue` 原来按查找二叉树的规则只往一边找（`node->data < value ? node->RT : node->LT`），但这里的树是按先序输入建的，不满足上面的特性，会漏掉节点，所以改成左右子树都找。如果建树时按查找二叉树的规则插入，才可以只往一边找。
- 输出查找结果时原来打印的是 `&temp`，那是局部指针变量 `temp` 自己的地址；节点的地址是 `temp`。
