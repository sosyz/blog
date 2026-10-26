---
title: "给 SL3000 刷 ImmortalWrt"
description: "保留原厂引导，用配置备份导入公钥拿到 SSH，只写 NOR 的 firmware 分区，再把 eMMC 挂成 extroot。"
type: 踩坑
topic: 运维与网络
tags: [OpenWrt, ImmortalWrt, 路由器, SL3000]
status: 已解决
pubDate: "2026-10-26"
---

前年看到自带 128 GB 存储的 SL3000，价格不错空间也大，立马下单结果买回来就扔在床底下吃灰一直没刷，今天又翻出来干脆刷了。

## 拿到原厂 SSH

原厂系统里 Dropbear 已经在监听 22 端口，只是登不进去。思路是从原厂固件里找到「恢复配置」的格式，把自己的公钥塞进配置备份，再从后台导入。需要两个文件：原厂 `04_firmware.bin`（firmware 分区镜像）和自己这台在后台导出的配置备份 `stock-backup.bin`。操作在 Linux / WSL 里离线完成，需要 `python3`、`openssl`、`tar`、`ssh-keygen` 和 squashfs-tools：

```bash
# 1. 在固件里找 SquashFS（魔数 hsqs），再用 unsquashfs 确认，魔数可能碰巧出现在别的数据里
python3 -c "import re; print([m.start() for m in re.finditer(b'hsqs', open('stock-firmware.bin','rb').read())])"
unsquashfs -s -o 3014656 stock-firmware.bin           # 这份固件的偏移是 0x2e0000，正好 23 个 128 KiB
dd if=stock-firmware.bin of=rootfs_sqfs.bin bs=131072 skip=23

# 2. 不用解开整个根文件系统，只读恢复配置相关的脚本
unsquashfs -cat rootfs_sqfs.bin usr/share/sysmgr/apps/sysbackup.sh | grep -n openssltar
#   openssltar.sh untar "$inpath" "$recover_dir" wjrc0409
unsquashfs -cat rootfs_sqfs.bin sbin/sysupgrade | grep -n -A 10 'if \[ -n "\$CONF_RESTORE" \]'
#   sysupgrade --restore-backup "$recover_dir/cfg.tar.tgz"

# 3. 解开自己的备份（文件头是 Salted__），口令就是脚本里的 wjrc0409
#    不要为了消除弃用提示加 -pbkdf2，加了就解不开
openssl enc -d -aes-256-cbc -salt -md sha256 -pass pass:wjrc0409 \
  -in stock-backup.bin -out backup-outer.tar.gz
tar -tzf backup-outer.tar.gz    # cfg.tar.tgz hw.txt openwrt_version openwrt_release time.txt
tar -xOzf backup-outer.tar.gz cfg.tar.tgz > original-config.tar.gz
tar -xOzf original-config.tar.gz etc/dropbear/authorized_keys > original-authorized_keys

# 4. 生成新密钥，把公钥追加进 authorized_keys，重新打包加密
mkdir -m 700 keys
ssh-keygen -t ed25519 -f keys/sl3000_ed25519 -C sl3000
python3 - <<'PY'
import io, tarfile
from pathlib import Path

def pack(members):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as tar:
        for info, data in members:
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()

old = Path("original-authorized_keys").read_bytes().rstrip(b"\n")
pub = Path("keys/sl3000_ed25519.pub").read_bytes().strip()
info = tarfile.TarInfo("etc/dropbear/authorized_keys")
info.mode, info.uid, info.gid, info.uname, info.gname = 0o600, 0, 0, "root", "root"
inner = pack([(info, (old + b"\n" if old else b"") + pub + b"\n")])

members = []
with tarfile.open("backup-outer.tar.gz") as src:
    for m in src.getmembers():
        data = inner if m.name == "cfg.tar.tgz" else src.extractfile(m).read()
        members.append((m, data))
Path("new-outer.tar.gz").write_bytes(pack(members))
PY
openssl enc -aes-256-cbc -salt -md sha256 -pass pass:wjrc0409 \
  -in new-outer.tar.gz -out add-ssh-key.bin

# 5. 上传前解开检查：内层只能有一个 -rw------- 0/0 的 etc/dropbear/authorized_keys
openssl enc -d -aes-256-cbc -salt -md sha256 -pass pass:wjrc0409 \
  -in add-ssh-key.bin -out verify-outer.tar.gz
tar -xOzf verify-outer.tar.gz cfg.tar.tgz | tar --numeric-owner -tvz

# 6. 后台「管理 → 备份/升级 → 上传恢复配置」上传 add-ssh-key.bin（别传到同页的固件升级里），设备会重启
ssh -i keys/sl3000_ed25519 -o IdentitiesOnly=yes root@192.168.211.1 'id; uname -r; cat /proc/uptime'
```

`wjrc0409` 是配置备份格式的固定口令，写死在 `sysbackup.sh` 里，不是签名私钥；另一个常见的字符串 `QiLunSmartWL` 是固件升级包用的，跟配置备份无关。恢复时固件只比对版本和硬件信息，然后 `sysupgrade` 把包直接解到根目录，这条路径上没有验签。所以只要往里放一个 `etc/dropbear/authorized_keys`，就能用自己的私钥登录，不用改 `/etc/shadow`，也不用刷固件。

> [!aside] 吐槽
> 加密了，但口令写死在固件里，也不验签。

新包里只有这一个文件，原有的公钥列表保留，外层的 `hw.txt` 等文件原样带回去。带盐加密每次输出都不一样，哈希对不上很正常。登录后 root 权限正常，内核仍是 5.4.231，uptime 说明确实重启过了，公钥是持久保存的。

## 内部布局

SSH 登录之后，先看看机器里有什么：

```bash
cat /etc/openwrt_release; uname -r   # 系统和内核版本
cat /proc/cpuinfo; free -m           # 芯片和内存
cat /proc/mtd                        # NOR 的分区
fdisk -l /dev/mmcblk0; df -h         # eMMC 的分区和挂载
```

结果是：MT7981B，1 GB 内存、32 MiB SPI NOR、标称 128 GB 的 eMMC。原厂系统 `V1.0-202408071620`，内核 5.4.231。

NOR 和 eMMC 都只是存储，刷的系统是 ImmortalWrt，NOR 里放的是引导、内核和一部分系统数据。原厂 NOR 分区：

| 分区 | 大小 | 用途 |
| --- | ---: | --- |
| BL2 | 1 MiB | 早期引导 |
| Config | 512 KiB | 配置 |
| Factory | 2 MiB | 校准等原厂数据 |
| FIP | 2 MiB | 启动固件包 |
| firmware | 25 MiB | 系统固件 |
| Product | 128 KiB | 产品数据 |
| Custom | 1408 KiB | 厂商自定义数据 |

eMMC 上只有一个大的 ext4 分区 `/dev/mmcblk0p1`，约 116.5 GiB。网上的迁移教程大多按多分区布局写，和这台不太一样，里面的分区编号和格式化命令需要注意下。

## 备份

拿到 SSH 先备份下关键区域：

- 完整的 32 MiB NOR，以及每个分区单独一份。
- eMMC 的 `boot0`、`boot1`，各 4 MiB。
- eMMC 首尾各 1 MiB，里面是主、备 GPT。
- 分区、挂载信息和已有文件的归档。
- 每个文件的 SHA-256，路由器上和电脑上的对得上。

## 自己编译

基于 ImmortalWrt `openwrt-24.10`，提交 `c9fcd0a502afa21438ca7a3c7dbae9e9993be638`，目标 `siluo_sl-3000-nor`，内核 6.6.157。

编完检查了 FIT 里内核和 DTB 的哈希、SquashFS 对齐、固件大小、设备标识和关键的设备树属性。

## 写入 NOR

写入前先试跑，没有直接刷：借原厂 U-Boot 的网络启动入口，把 initramfs 加载到内存里，先进一个临时系统（下面叫 RAM 系统）验证。第一版镜像在里面暴露出 MAC 地址来源不对，又修了一版刷上去。

原厂系统因为设备标识对不上，拒绝了自编译的镜像。没加强制参数硬刷，而是在 RAM 系统里核对完板型和升级路径，再用标准的升级流程写入。写入范围只有 NOR 的 firmware 分区：偏移 `0x580000`，25 MiB。

升级时 SSH 断开是正常的，后台能打开也不代表就成了。重连后再次确认：

- 从 NOR 的 SquashFS/JFFS2 启动，RAM 系统的标记没了。
- 内核和根文件系统区域读回的哈希对得上。
- LAN/WAN MAC、SSH、LuCI 都正常。
- BL2、Config、Factory、FIP、Product、Custom 的哈希和备份一致，eMMC 启动区和首尾也没变。
- 关掉电脑上的服务、清掉临时网络设置后，路由器自己重启也没问题。

## 把 eMMC 用起来

刷完后系统用的还是 NOR 里那点可写空间，128 GB 的 eMMC 不会自己派上用场。用 extroot 把 `/dev/mmcblk0p1` 挂成 `/overlay`：

```text
NOR：原厂引导 + ImmortalWrt 内核 + 只读基础系统
eMMC：/overlay，放插件和配置
RAM：/tmp，临时文件
```

LuCI 里 `/rom` 显示 100% 是正常的，那是只读的基础系统，要看的是 `/overlay`。

以后升级内核需要注意 eMMC 上装过的包和内核模块不一定还能用，不能只换 NOR 镜像。

## SQM

装 SQM 时卡在了内核依赖上。版本号都是 6.6.157，但==内核配置不同，模块的 ABI 也可能不同==，所以不能混装。想单独编 IFB 模块，又因为缺 `CONFIG_NET_REDIRECT` 编不过，这不是忽略依赖能解决的。最后整个重编出一个镜像，把 SQM、CAKE、IFB、tc-full 和系统统计都编进去，升级后重新处理了 extroot。

不开 SQM 时，下载约 309–331 Mbps，上传约 46–49 Mbps。默认的 CAKE 在这个环境里上传掉得厉害，对比之后用了：

| 项目 | 设置 |
| --- | --- |
| 出口接口 | `phy1-sta0` |
| 下载 | 275000 kbit/s |
| 上传 | 40000 kbit/s |
| 队列 | `fq_codel` |
| 脚本 | `simplest_tbf.qos` |
| 软件、硬件流量卸载 | 关 |

## 最后

| 项目 | 结果 |
| --- | --- |
| 原厂 SSH | 导入公钥，重启后登录成功 |
| 备份 | NOR 和 eMMC 关键区域校验通过，没有整盘镜像 |
| NOR 固件 | 刷入、读回校验、独立重启都通过 |
| 原厂保护分区 | 哈希和备份一致 |
| eMMC extroot | 重启后挂载和数据都在 |
| 系统统计 | 正常，重编镜像升级后已恢复 |
| SQM | 队列和负载测试通过，调参后没再整机重启验证 |

## 参考

- [ImmortalWrt](https://github.com/immortalwrt/immortalwrt)
