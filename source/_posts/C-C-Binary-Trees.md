---
title: C/C++ 二叉树
date: 2020-11-19 19:43:21
tags:
---

对于数据结构初学者二叉树是一个很好的练习题目，这里记录一下二叉树的一些操作。

<!-- more -->

查找二叉树有一个特性

> 对于所有的节点，都满足左子树上的所有节点都比自己的小，而右子树上的所有节点都比自己大
> ————《挑战程序设计竞赛第二版》P78

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
    if (node == NULL) return NULL;
    if (node->data == value) {
        cout << "ok, find it." << endl;
        return node;
    }
    else
        return findValue(node->data < value ? node->RT : node->LT, value);
    return NULL;
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
    else cout << "find in " << &temp << ", data: " << (char)temp->data << endl;

}
```
