import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../store/familyStore';
import { v4 as uuidv4 } from 'uuid';
import {
  solarToLunar,
  lunarToSolar,
  formatLunarDate,
  calculatePhotoAge,
  getFullName,
  getLunarLeapMonth,
  getSiblingRank,
} from '../utils';
import { Lunar } from 'lunar-javascript';
import { isTauri, convertLocalSrc, saveMediaFile, deleteMediaFile } from '../utils/tauri';
import AvatarCropModal from '../components/AvatarCropModal';
import type { Person, Gender, LunarDate, SpouseRelationType } from '../types';
import { getAdoptiveFathers, getAdoptiveMothers } from '../types';
import chinaRegions from '../data/china-regions.json';
import './PersonEditPage.css';

// 产生年份列表 (1900 - 2030)
const YEARS = Array.from({ length: 131 }, (_, i) => 1900 + i);
// 产生小时列表 (00 - 23)
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
// 产生分钟/秒列表 (00 - 59)
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

// 中国行政区划数据类型（省 → 市 → 县区 → 乡镇街道）
type ChinaRegions = Record<string, Record<string, Record<string, string[]>>>;
const REGIONS = chinaRegions as ChinaRegions;

export default function PersonEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, getPerson, updatePerson, addPerson, getPersonsList, addSpouse, removeSpouse } = useFamilyStore();

  const isNew = id === 'new';
  const existingPerson = id && !isNew ? getPerson(id) : undefined;
  const allPersons = getPersonsList();

  // 表单状态
  const [surname, setSurname] = useState(project?.meta.surname || '');
  const [givenName, setGivenName] = useState('');
  const [gender, setGender] = useState<Gender>('male');
  const [isAlive, setIsAlive] = useState(true);
  // 出生地拆分：省 / 市 / 县区 / 乡镇 / 详细地址
  const [placeProvince, setPlaceProvince] = useState('');
  const [placeCity, setPlaceCity] = useState('');
  const [placeArea, setPlaceArea] = useState('');
  const [placeTown, setPlaceTown] = useState('');
  const [placeDetail, setPlaceDetail] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | undefined>();
  const [avatarRect, setAvatarRect] = useState<string | undefined>();
  const [avatarPhotoDate, setAvatarPhotoDate] = useState('');
  const [newAvatarBase64, setNewAvatarBase64] = useState<string | null>(null);
  const [newAvatarRectBase64, setNewAvatarRectBase64] = useState<string | null>(null);
  const [cropModalImage, setCropModalImage] = useState<string | null>(null);
  const [avatarToDelete, setAvatarToDelete] = useState<boolean>(false);

  // 关系状态
  const [fatherId, setFatherId] = useState<string>('');
  const [motherId, setMotherId] = useState<string>('');
  const [adoptiveFatherIds, setAdoptiveFatherIds] = useState<string[]>([]);
  const [adoptiveMotherIds, setAdoptiveMotherIds] = useState<string[]>([]);

  // 配偶关系状态
  const [spouseEntries, setSpouseEntries] = useState<{ id: string; type: SpouseRelationType }[]>([]);

  // 子女关系状态
  const [childEntries, setChildEntries] = useState<{ id: string; type: string }[]>([]);

  // 动态关系状态：兄弟姐妹
  const [siblingIds, setSiblingIds] = useState<string[]>([]);

  // 日期录入 Tab 模式：'solar' (公历录入) | 'lunar' (农历录入)
  const [birthInputMode, setBirthInputMode] = useState<'solar' | 'lunar'>('solar');

  // 生日：公历状态 (数字)
  const [sBirthYear, setSBirthYear] = useState<number>(1990);
  const [sBirthMonth, setSBirthMonth] = useState<number>(1);
  const [sBirthDay, setSBirthDay] = useState<number>(1);
  const [sBirthHour, setSBirthHour] = useState<string>('00');
  const [sBirthMin, setSBirthMin] = useState<string>('00');
  const [sBirthSec, setSBirthSec] = useState<string>('00');

  // 生日：农历状态 (数字)
  const [lBirthYear, setLBirthYear] = useState<number>(1990);
  const [lBirthMonth, setLBirthMonth] = useState<number>(1); // 1-12
  const [lBirthIsLeap, setLBirthIsLeap] = useState<boolean>(false);
  const [lBirthDay, setLBirthDay] = useState<number>(1);

  // 逝世：公历状态
  const [sDeathYear, setSDeathYear] = useState<number>(2020);
  const [sDeathMonth, setSDeathMonth] = useState<number>(1);
  const [sDeathDay, setSDeathDay] = useState<number>(1);
  const [sDeathHour, setSDeathHour] = useState<string>('00');
  const [sDeathMin, setSDeathMin] = useState<string>('00');
  const [sDeathSec, setSDeathSec] = useState<string>('00');

  // ==================== 级联天数计算工具 ====================

  // 获取某年公历月的天数
  const getSolarDaysInMonth = (y: number, m: number): number => {
    return new Date(y, m, 0).getDate();
  };

  // 获取某年农历月的天数
  const getLunarDaysInMonth = (y: number, m: number, isLeap: boolean): number => {
    try {
      const monthParam = isLeap ? -m : m;
      const lunarObj = Lunar.fromYmd(y, monthParam, 30);
      return lunarObj.getDay() === 30 ? 30 : 29;
    } catch {
      return 29;
    }
  };

  // 获取某农历年份的闰月月份 (0 表示没有)
  const getLeapMonthOfYear = (y: number): number => {
    return getLunarLeapMonth(y);
  };

  // 转换农历月份为中文汉字数字（正月、冬月、腊月等传统叫法）
  const getLunarMonthName = (m: number): string => {
    const ChineseMonths = ['', '正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
    return ChineseMonths[m] || `${m}`;
  };

  // 转换农历日期为中文汉字数字（如初一、十一、廿一等）
  const getLunarDayName = (d: number): string => {
    const ChineseDays = [
      '',
      '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
      '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
      '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
    ];
    return ChineseDays[d] || `${d}日`;
  };

  // ==================== 联动计算核心 ====================

  // 1. 公历变更联动推算农历
  const handleSolarChange = useCallback((y: number, m: number, d: number) => {
    const maxDays = getSolarDaysInMonth(y, m);
    const validD = d > maxDays ? maxDays : d;

    setSBirthYear(y);
    setSBirthMonth(m);
    setSBirthDay(validD);

    const formattedDate = `${y}-${String(m).padStart(2, '0')}-${String(validD).padStart(2, '0')}T00:00:00`;
    const lunar = solarToLunar(formattedDate);
    if (lunar) {
      setLBirthYear(lunar.year);
      setLBirthMonth(lunar.month);
      setLBirthDay(lunar.day);
      setLBirthIsLeap(lunar.isLeap);
    }
  }, []);

  // 2. 农历变更联动推算公历
  const handleLunarChange = useCallback((y: number, m: number, isLeap: boolean, d: number) => {
    // 限制农历日期在当前农历月的合法天数范围内
    const maxDays = getLunarDaysInMonth(y, m, isLeap);
    const validD = d > maxDays ? maxDays : d;

    setLBirthYear(y);
    setLBirthMonth(m);
    setLBirthIsLeap(isLeap);
    setLBirthDay(validD);

    const lunarData: LunarDate = {
      year: y,
      month: m,
      day: validD,
      isLeap,
    };
    const solarStr = lunarToSolar(lunarData);
    if (solarStr) {
      const date = new Date(solarStr);
      setSBirthYear(date.getFullYear());
      setSBirthMonth(date.getMonth() + 1);
      setSBirthDay(date.getDate());
    }
  }, []);

  // 3. 数据加载与初次数据推算联动
  useEffect(() => {
    if (existingPerson) {
      setSurname(existingPerson.surname);
      setGivenName(existingPerson.givenName);
      setGender(existingPerson.gender);
      setIsAlive(existingPerson.isAlive);
      // 拆分出生地字符串到多级下拉框 + 详细地址
      const parts = (existingPerson.birthPlace || '').split(' ');
      setPlaceProvince(parts[0] || '');
      setPlaceCity(parts[1] || '');
      setPlaceArea(parts[2] || '');
      setPlaceTown(parts[3] || '');
      setPlaceDetail(parts.slice(4).join(' ') || '');
      setBio(existingPerson.bio || '');
      setAvatar(existingPerson.avatar);
      setAvatarRect(existingPerson.avatarRect);
      setAvatarPhotoDate(existingPerson.avatarPhotoDate || '');
      setAvatarToDelete(false);
      setNewAvatarBase64(null);
      setNewAvatarRectBase64(null);
      let initFatherId = existingPerson.relations.father || '';
      let initMotherId = existingPerson.relations.mother || '';

      // 智能推导：若只有生母且无生父，且生母有且仅有一个配偶，则默认回填该配偶为生父
      if (!initFatherId && initMotherId && project) {
        const motherObj = project.persons[initMotherId];
        if (motherObj && motherObj.relations.spouses && motherObj.relations.spouses.length === 1) {
          initFatherId = motherObj.relations.spouses[0].id;
        }
      }
      // 智能推导：若只有生父且无生母，且生父有且仅有一个配偶，则默认回填该配偶为生母
      if (!initMotherId && initFatherId && project) {
        const fatherObj = project.persons[initFatherId];
        if (fatherObj && fatherObj.relations.spouses && fatherObj.relations.spouses.length === 1) {
          initMotherId = fatherObj.relations.spouses[0].id;
        }
      }

      setFatherId(initFatherId);
      setMotherId(initMotherId);
      setAdoptiveFatherIds(getAdoptiveFathers(existingPerson.relations));
      setAdoptiveMotherIds(getAdoptiveMothers(existingPerson.relations));

      // 加载配偶关系
      setSpouseEntries(
        (existingPerson.relations.spouses || []).map(s => ({ id: s.id, type: s.type }))
      );

      // 加载子女关系
      setChildEntries(
        (existingPerson.relations.children || []).map(c => ({ id: c.id, type: c.type }))
      );

      // 提取已有手足关系
      const f = existingPerson.relations.father;
      const m = existingPerson.relations.mother;
      const afs = getAdoptiveFathers(existingPerson.relations);
      const ams = getAdoptiveMothers(existingPerson.relations);

      const currentSiblings = Object.values(project?.persons || {}).filter((p: any) => {
        if (p.id === existingPerson.id) return false;
        const shareFather = f && p.relations.father === f;
        const shareMother = m && p.relations.mother === m;
        const shareAdoptiveFather = afs.length > 0 && getAdoptiveFathers(p.relations).some(af => afs.includes(af));
        const shareAdoptiveMother = ams.length > 0 && getAdoptiveMothers(p.relations).some(am => ams.includes(am));
        return shareFather || shareMother || shareAdoptiveFather || shareAdoptiveMother;
      }).map((p: any) => p.id);

      setSiblingIds(currentSiblings);

      // 回填公历生日数字
      if (existingPerson.birthDateSolar) {
        const date = new Date(existingPerson.birthDateSolar);
        setSBirthYear(date.getFullYear());
        setSBirthMonth(date.getMonth() + 1);
        setSBirthDay(date.getDate());
        setSBirthHour(String(date.getHours()).padStart(2, '0'));
        setSBirthMin(String(date.getMinutes()).padStart(2, '0'));
        setSBirthSec(String(date.getSeconds()).padStart(2, '0'));
      }

      // 回填农历生日数字
      if (existingPerson.birthDateLunar) {
        const lunar = existingPerson.birthDateLunar;
        setLBirthYear(lunar.year);
        setLBirthMonth(lunar.month);
        setLBirthDay(lunar.day);
        setLBirthIsLeap(lunar.isLeap);
      }

      // 回填公历逝世数字
      if (existingPerson.deathDateSolar) {
        const date = new Date(existingPerson.deathDateSolar);
        setSDeathYear(date.getFullYear());
        setSDeathMonth(date.getMonth() + 1);
        setSDeathDay(date.getDate());
        setSDeathHour(String(date.getHours()).padStart(2, '0'));
        setSDeathMin(String(date.getMinutes()).padStart(2, '0'));
        setSDeathSec(String(date.getSeconds()).padStart(2, '0'));
      }
    } else {
      // 默认推算
      handleSolarChange(1990, 1, 1);
    }
  }, [existingPerson, handleSolarChange]);

  // 头像上传 - 选择文件后打开裁剪弹窗
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setCropModalImage(base64);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // 裁剪确认后回调
  const handleCropSave = (circleDataUrl: string, rectDataUrl: string) => {
    setAvatar(circleDataUrl);
    setNewAvatarBase64(circleDataUrl);
    setAvatarRect(rectDataUrl);
    setNewAvatarRectBase64(rectDataUrl);
    setAvatarToDelete(false);
    setCropModalImage(null);
  };

  // 删除头像
  const handleDeleteAvatar = () => {
    setAvatar(undefined);
    setAvatarRect(undefined);
    setNewAvatarBase64(null);
    setNewAvatarRectBase64(null);
    setAvatarPhotoDate('');
    setAvatarToDelete(true);
  };

  // 保存数据
  const handleSave = async () => {
    await doSave();
  };

  const handleConfirmFirstPerson = () => {
    setShowFirstPersonDialog(false);
    setFirstPersonConfirmed(true);
  };

  const doSave = async () => {
    let finalAvatar = avatar;
    let finalAvatarRect = avatarRect;

    // 如果新上传了头像，并且处于 Tauri 环境绑定了本地工作区目录
    const workspacePath = useFamilyStore.getState().currentFilePath;
    if (isTauri() && newAvatarBase64 && workspacePath) {
      try {
        let ext = 'jpg';
        const match = newAvatarBase64.match(/data:image\/([a-zA-Z+]+);base64/);
        if (match && match[1]) {
          ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        }

        // 以随机 UUID 命名生成不冲突的文件名
        const randomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        const filename = `avatar_${randomId}.${ext}`;

        await saveMediaFile(workspacePath, filename, newAvatarBase64);

        // 绑定物理路径
        finalAvatar = `${workspacePath}/media/${filename}`;
      } catch (err) {
        console.error('物理写入头像文件失败:', err);
      }
    }

    // 同时保存矩形原图到工作区
    if (isTauri() && newAvatarRectBase64 && workspacePath) {
      try {
        let ext = 'jpg';
        const match = newAvatarRectBase64.match(/data:image\/([a-zA-Z+]+);base64/);
        if (match && match[1]) {
          ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        }

        const randomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        const filename = `avatar_rect_${randomId}.${ext}`;

        await saveMediaFile(workspacePath, filename, newAvatarRectBase64);

        finalAvatarRect = `${workspacePath}/media/${filename}`;
      } catch (err) {
        console.error('物理写入矩形头像文件失败:', err);
      }
    }

    // 删除旧头像物理文件（如果用户主动删除了头像）
    if (avatarToDelete && existingPerson && isTauri() && workspacePath) {
      try {
        if (existingPerson.avatar && !existingPerson.avatar.startsWith('data:')) {
          await deleteMediaFile(workspacePath, existingPerson.avatar).catch(() => {});
        }
        if (existingPerson.avatarRect && !existingPerson.avatarRect.startsWith('data:')) {
          await deleteMediaFile(workspacePath, existingPerson.avatarRect).catch(() => {});
        }
      } catch (err) {
        console.error('删除旧头像文件失败:', err);
      }
    } else if (
      !avatarToDelete &&
      existingPerson &&
      isTauri() &&
      workspacePath &&
      existingPerson.avatar &&
      newAvatarBase64 &&
      existingPerson.avatar !== finalAvatar &&
      !existingPerson.avatar.startsWith('data:')
    ) {
      // 用户重新上传了新头像，且与旧头像不同，则删除旧头像物理文件
      try {
        await deleteMediaFile(workspacePath, existingPerson.avatar).catch(() => {});
        if (existingPerson.avatarRect && !existingPerson.avatarRect.startsWith('data:')) {
          await deleteMediaFile(workspacePath, existingPerson.avatarRect).catch(() => {});
        }
      } catch (err) {
        console.error('删除旧头像文件失败:', err);
      }
    }

    // 拼出公历生日。若时分秒未设置或全为0，在精度上标记为 'date'，不影响展示
    const birthYearStr = String(sBirthYear).padStart(4, '0');
    const birthMonthStr = String(sBirthMonth).padStart(2, '0');
    const birthDayStr = String(sBirthDay).padStart(2, '0');
    const birthHourStr = sBirthHour.padStart(2, '0');
    const birthMinStr = sBirthMin.padStart(2, '0');
    const birthSecStr = sBirthSec.padStart(2, '0');
    const birthDateSolar = `${birthYearStr}-${birthMonthStr}-${birthDayStr}T${birthHourStr}:${birthMinStr}:${birthSecStr}`;

    const isBirthTimeProvided = birthHourStr !== '00' || birthMinStr !== '00' || birthSecStr !== '00';

    // 农历生日结构数据
    const birthDateLunar: LunarDate = {
      year: lBirthYear,
      month: lBirthMonth,
      day: lBirthDay,
      isLeap: lBirthIsLeap,
      monthChinese: Lunar.fromYmd(lBirthYear, lBirthIsLeap ? -lBirthMonth : lBirthMonth, lBirthDay).getMonthInChinese(),
      dayChinese: Lunar.fromYmd(lBirthYear, lBirthIsLeap ? -lBirthMonth : lBirthMonth, lBirthDay).getDayInChinese(),
    };

    // 拼出公历逝世日期
    let deathDateSolar: string | undefined = undefined;
    let deathTimePrecision: 'date' | 'time' = 'date';
    if (!isAlive) {
      const dYearStr = String(sDeathYear).padStart(4, '0');
      const dMonthStr = String(sDeathMonth).padStart(2, '0');
      const dDayStr = String(sDeathDay).padStart(2, '0');
      const dHourStr = sDeathHour.padStart(2, '0');
      const dMinStr = sDeathMin.padStart(2, '0');
      const dSecStr = sDeathSec.padStart(2, '0');
      deathDateSolar = `${dYearStr}-${dMonthStr}-${dDayStr}T${dHourStr}:${dMinStr}:${dSecStr}`;
      if (dHourStr !== '00' || dMinStr !== '00' || dSecStr !== '00') {
        deathTimePrecision = 'time';
      }
    }

    // 获取保存前已有的兄弟姐妹 ID
    const origSiblingIds: string[] = [];
    if (existingPerson && project) {
      Object.values(project.persons).forEach((p) => {
        if (p.id === existingPerson.id) return;
        const shareFather = existingPerson.relations.father && p.relations.father === existingPerson.relations.father;
        const shareMother = existingPerson.relations.mother && p.relations.mother === existingPerson.relations.mother;
        const shareAdoptiveFather = existingPerson.relations.adoptiveFather && p.relations.adoptiveFather === existingPerson.relations.adoptiveFather;
        const shareAdoptiveMother = existingPerson.relations.adoptiveMother && p.relations.adoptiveMother === existingPerson.relations.adoptiveMother;
        if (shareFather || shareMother || shareAdoptiveFather || shareAdoptiveMother) {
          origSiblingIds.push(p.id);
        }
      });
    }
    const removedSiblingIds = origSiblingIds.filter(sid => !siblingIds.includes(sid));

    // 计算最终要写入的父母 ID 链
    let finalFatherId = fatherId;
    let finalMotherId = motherId;
    let finalAdoptiveFatherIds = [...adoptiveFatherIds].filter(Boolean);
    let finalAdoptiveMotherIds = [...adoptiveMotherIds].filter(Boolean);

    const currentPersonId = id && !isNew ? id : uuidv4();

    if (project) {
      // 若生父母未设置，但选中手足已设置，则自动继承其父母
      if (!finalFatherId && !finalMotherId) {
        for (const sibId of siblingIds) {
          const sib = project.persons[sibId];
          if (sib && (sib.relations.father || sib.relations.mother)) {
            finalFatherId = sib.relations.father || '';
            finalMotherId = sib.relations.mother || '';
            break;
          }
        }
      }
      // 养父母做同等继承
      if (finalAdoptiveFatherIds.length === 0 && finalAdoptiveMotherIds.length === 0) {
        for (const sibId of siblingIds) {
          const sib = project.persons[sibId];
          if (sib) {
            const sibAFs = getAdoptiveFathers(sib.relations);
            const sibAMs = getAdoptiveMothers(sib.relations);
            if (sibAFs.length > 0 || sibAMs.length > 0) {
              finalAdoptiveFatherIds = sibAFs;
              finalAdoptiveMotherIds = sibAMs;
              break;
            }
          }
        }
      }

      // 如果依然无父母，但在表单中强行拉了手足关联，自动在后台生成一对隐藏占位父母节点
      if (!finalFatherId && !finalMotherId && siblingIds.length > 0) {
        const genFatherId = uuidv4();
        const genMotherId = uuidv4();
        const now = new Date().toISOString();

        const virtualFather: Person = {
          id: genFatherId,
          surname: surname || project.meta.surname || '未设置',
          givenName: '（父亲）',
          gender: 'male',
          birthTimePrecision: 'date',
          deathTimePrecision: 'date',
          isAlive: true,
          photos: [],
          audioFiles: [],
          videoFiles: [],
          relations: { spouses: [{ id: genMotherId, type: 'married' }], children: [] },
          isDefaultPerspective: false,
          createdAt: now,
          updatedAt: now,
        };

        const virtualMother: Person = {
          id: genMotherId,
          surname: '',
          givenName: '（母亲）',
          gender: 'female',
          birthTimePrecision: 'date',
          deathTimePrecision: 'date',
          isAlive: true,
          photos: [],
          audioFiles: [],
          videoFiles: [],
          relations: { spouses: [{ id: genFatherId, type: 'married' }], children: [] },
          isDefaultPerspective: false,
          createdAt: now,
          updatedAt: now,
        };

        project.persons[genFatherId] = virtualFather;
        project.persons[genMotherId] = virtualMother;

        finalFatherId = genFatherId;
        finalMotherId = genMotherId;
      }
    }

    const personData: Partial<Person> = {
      id: currentPersonId,
      surname,
      givenName,
      gender,
      birthDateSolar,
      birthTimePrecision: isBirthTimeProvided ? 'time' : 'date',
      birthDateLunar,
      deathDateSolar,
      deathTimePrecision,
      isAlive,
      birthPlace: [placeProvince, placeCity, placeArea, placeTown, placeDetail].filter(Boolean).join(' ') || undefined,
      bio: bio || undefined,
      avatar: finalAvatar,
      avatarRect: finalAvatarRect,
      avatarPhotoDate: avatarPhotoDate || undefined,
      relations: {
        father: finalFatherId || undefined,
        mother: finalMotherId || undefined,
        adoptiveFather: finalAdoptiveFatherIds[0] || undefined,
        adoptiveMother: finalAdoptiveMotherIds[0] || undefined,
        adoptiveFathers: finalAdoptiveFatherIds.length > 0 ? finalAdoptiveFatherIds : undefined,
        adoptiveMothers: finalAdoptiveMotherIds.length > 0 ? finalAdoptiveMotherIds : undefined,
        spouses: spouseEntries.filter(s => s.id),
        children: childEntries.filter(c => c.id).map(c => ({ id: c.id, type: c.type as any })),
      },
    };

    if (isNew) {
      await addPerson(personData);
    } else {
      await updatePerson(currentPersonId, personData);
    }

    // 后续手足及父母子嗣属性双向同步
    if (project) {
      // 1. 同步将兄弟姐妹的父母设为跟本人一致
      for (const sibId of siblingIds) {
        const sib = project.persons[sibId];
        if (sib) {
          sib.relations.father = finalFatherId || undefined;
          sib.relations.mother = finalMotherId || undefined;
          if (finalAdoptiveFatherIds.length > 0) {
            sib.relations.adoptiveFathers = finalAdoptiveFatherIds;
            sib.relations.adoptiveFather = finalAdoptiveFatherIds[0];
          }
          if (finalAdoptiveMotherIds.length > 0) {
            sib.relations.adoptiveMothers = finalAdoptiveMotherIds;
            sib.relations.adoptiveMother = finalAdoptiveMotherIds[0];
          }
          await updatePerson(sibId, { relations: sib.relations });
        }
      }

      // 2. 将被剔除的兄弟姐妹的父母关系置空
      for (const remId of removedSiblingIds) {
        const rem = project.persons[remId];
        if (rem) {
          if (rem.relations.father === finalFatherId) rem.relations.father = undefined;
          if (rem.relations.mother === finalMotherId) rem.relations.mother = undefined;
          // 清理养父母数组引用
          if (rem.relations.adoptiveFathers) {
            rem.relations.adoptiveFathers = rem.relations.adoptiveFathers.filter(id => !finalAdoptiveFatherIds.includes(id));
          }
          if (rem.relations.adoptiveMothers) {
            rem.relations.adoptiveMothers = rem.relations.adoptiveMothers.filter(id => !finalAdoptiveMotherIds.includes(id));
          }
          await updatePerson(remId, { relations: rem.relations });
        }
      }

      // 3. 同步更新生父母节点的 children 列表
      const allChildrenIds = [currentPersonId, ...siblingIds];

      const updateParentChildren = async (parentId: string) => {
        const parent = project.persons[parentId];
        if (parent) {
          const origChildren = parent.relations.children || [];
          let updatedChildren = origChildren.filter(c => !removedSiblingIds.includes(c.id));
          allChildrenIds.forEach(cid => {
            if (!updatedChildren.some(c => c.id === cid)) {
              updatedChildren.push({ id: cid, type: 'biological' });
            }
          });
          parent.relations.children = updatedChildren;
          await updatePerson(parentId, { relations: parent.relations });
        }
      };

      if (finalFatherId) await updateParentChildren(finalFatherId);
      if (finalMotherId) await updateParentChildren(finalMotherId);

      // 4. 同步配偶关系（双向）
      const oldSpouseIds = new Set((existingPerson?.relations.spouses || []).map(s => s.id));
      const newSpouseIds = new Set(spouseEntries.filter(s => s.id).map(s => s.id));

      // 删除旧配偶
      for (const oldSid of oldSpouseIds) {
        if (!newSpouseIds.has(oldSid)) {
          removeSpouse(currentPersonId, oldSid);
        }
      }
      // 添加新配偶
      for (const entry of spouseEntries) {
        if (entry.id && !oldSpouseIds.has(entry.id)) {
          addSpouse(currentPersonId, entry.id, entry.type);
        }
      }

      // 5. 同步子女关系（双向）
      for (const entry of childEntries) {
        if (!entry.id) continue;
        const child = project.persons[entry.id];
        if (child) {
          // 根据当前人员性别设置子女的父/母
          if (gender === 'male') {
            if (child.relations.father !== currentPersonId) {
              child.relations.father = currentPersonId;
              await updatePerson(entry.id, { relations: child.relations });
            }
          } else {
            if (child.relations.mother !== currentPersonId) {
              child.relations.mother = currentPersonId;
              await updatePerson(entry.id, { relations: child.relations });
            }
          }
        }
      }
    }

    navigate(`/person/${currentPersonId}`);
  };

  const calculatedBirthSolarStr = `${String(sBirthYear).padStart(4, '0')}-${String(sBirthMonth).padStart(2, '0')}-${String(sBirthDay).padStart(2, '0')}`;
  const photoAgeText = calculatedBirthSolarStr && avatarPhotoDate
    ? calculatePhotoAge(calculatedBirthSolarStr, avatarPhotoDate)
    : null;

  const [showRelationMenu, setShowRelationMenu] = useState<boolean>(false);

  // 第一人默认视角确认对话框
  const isFirstPerson = isNew && Object.keys(project?.persons || {}).length === 0;
  const [showFirstPersonDialog, setShowFirstPersonDialog] = useState(false);
  const [firstPersonConfirmed, setFirstPersonConfirmed] = useState(false);

  // 进入编辑页时（挂载阶段）立即弹窗提示默认视角
  useEffect(() => {
    if (isFirstPerson && !firstPersonConfirmed) {
      setShowFirstPersonDialog(true);
    }
  }, [isFirstPerson, firstPersonConfirmed]);

  // 模拟临时全谱数据状态以实时计算兄弟姐妹长幼称呼
  const getTempPersons = () => {
    const bYear = String(sBirthYear).padStart(4, '0');
    const bMonth = String(sBirthMonth).padStart(2, '0');
    const bDay = String(sBirthDay).padStart(2, '0');
    const bHour = sBirthHour.padStart(2, '0');
    const bMin = sBirthMin.padStart(2, '0');
    const bSec = sBirthSec.padStart(2, '0');
    const tempBirthSolar = `${bYear}-${bMonth}-${bDay}T${bHour}:${bMin}:${bSec}`;

    const currentPersonId = id && id !== 'new' ? id : 'temp-new-id';

    const selfTemp: any = {
      id: currentPersonId,
      gender,
      birthDateSolar: tempBirthSolar,
      createdAt: existingPerson?.createdAt || new Date().toISOString(),
      relations: {
        father: fatherId || undefined,
        mother: motherId || undefined,
        adoptiveFathers: adoptiveFatherIds.length > 0 ? adoptiveFatherIds : undefined,
        adoptiveMothers: adoptiveMotherIds.length > 0 ? adoptiveMotherIds : undefined,
      }
    };

    const basePersons = { ...(project?.persons || {}), [currentPersonId]: selfTemp };

    siblingIds.forEach(sibId => {
      const sibObj = basePersons[sibId];
      if (sibObj) {
        basePersons[sibId] = {
          ...sibObj,
          relations: {
            ...sibObj.relations,
            father: fatherId || undefined,
            mother: motherId || undefined,
            adoptiveFathers: adoptiveFatherIds.length > 0 ? adoptiveFatherIds : undefined,
            adoptiveMothers: adoptiveMotherIds.length > 0 ? adoptiveMotherIds : undefined,
          }
        };
      }
    });

    return basePersons;
  };

  const availablePersons = allPersons.filter((p) => p.id !== id);

  // ==================== 选项集生成 ====================

  // 生成当前公历年的最大天数列表
  const solarDaysList = Array.from(
    { length: getSolarDaysInMonth(sBirthYear, sBirthMonth) },
    (_, i) => i + 1
  );

  const leapMonth = getLeapMonthOfYear(lBirthYear);
  const lunarMonthsOptions: { value: string; label: string; m: number; isLeap: boolean }[] = [];
  for (let m = 1; m <= 12; m++) {
    lunarMonthsOptions.push({ value: `${m}`, label: getLunarMonthName(m), m, isLeap: false });
    if (leapMonth > 0 && leapMonth === m) {
      lunarMonthsOptions.push({ value: `leap-${m}`, label: `闰${getLunarMonthName(m)}`, m, isLeap: true });
    }
  }

  // 生成当前农历月的天数列表
  const lunarDaysList = Array.from(
    { length: getLunarDaysInMonth(lBirthYear, lBirthMonth, lBirthIsLeap) },
    (_, i) => i + 1
  );

  // 逝世公历最大天数
  const deathSolarDaysList = Array.from(
    { length: getSolarDaysInMonth(sDeathYear, sDeathMonth) },
    (_, i) => i + 1
  );

  return (
    <div className="person-edit-page">
      <div className="person-edit-header">
        <h2>{isNew ? '添加人员' : `编辑 ${getFullName(surname, givenName)}`}</h2>
        <div className="person-edit-header-actions">
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>

      {/* 头像区域 */}
      <div className="avatar-upload-section">
        <div className="avatar-upload-wrapper">
          <input
            type="file"
            accept="image/*"
            onChange={handleAvatarUpload}
            style={{ display: 'none' }}
            id="avatar-upload"
          />
          <label htmlFor="avatar-upload" style={{ cursor: 'pointer' }}>
            {avatar ? (
              <img src={convertLocalSrc(avatar)} alt="头像" className="avatar-preview" />
            ) : (
              <div className="avatar-upload-placeholder">
                <span className="upload-icon">📷</span>
                <span>上传照片</span>
              </div>
            )}
          </label>
          {avatar && (
            <button
              type="button"
              className="avatar-delete-btn"
              title="删除头像"
              onClick={handleDeleteAvatar}
            >
              ×
            </button>
          )}
        </div>

        <div className="avatar-photo-date">
          <span>拍摄于</span>
          <input
            type="date"
            value={avatarPhotoDate}
            onChange={(e) => setAvatarPhotoDate(e.target.value)}
          />
        </div>
        {photoAgeText && (
          <div className="avatar-age-tag">
            📷 {photoAgeText}时的照片
          </div>
        )}
      </div>

      {/* 基本信息 */}
      <div className="form-section">
        <div className="form-section-title">基本信息</div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">姓</label>
            <input
              type="text"
              className="form-input"
              value={surname}
              onChange={(e) => setSurname(e.target.value)}
              placeholder="姓氏"
            />
          </div>
          <div className="form-group">
            <label className="form-label">名</label>
            <input
              type="text"
              className="form-input"
              value={givenName}
              onChange={(e) => setGivenName(e.target.value)}
              placeholder="名字"
              autoFocus={isNew}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">性别</label>
          <div className="gender-selector">
            <button
              type="button"
              className={`gender-option ${gender === 'male' ? 'selected' : ''}`}
              onClick={() => setGender('male')}
            >
              ♂ 男
            </button>
            <button
              type="button"
              className={`gender-option ${gender === 'female' ? 'selected' : ''}`}
              onClick={() => setGender('female')}
            >
              ♀ 女
            </button>
          </div>
        </div>
      </div>

      {/* 生卒信息级联下拉框选择 */}
      <div className="form-section">
        <div className="form-section-title">生卒信息</div>

        <div className="form-group">
          <div className="birth-mode-tabs" style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: '16px' }}>
            <button
              type="button"
              style={{
                flex: 1,
                padding: '8px 16px',
                border: 'none',
                background: birthInputMode === 'solar' ? 'var(--color-accent-dark)' : 'transparent',
                color: birthInputMode === 'solar' ? '#fff' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '14px',
                transition: 'all 0.2s',
                textAlign: 'center'
              }}
              onClick={() => setBirthInputMode('solar')}
            >
              公历录入
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                padding: '8px 16px',
                border: 'none',
                borderLeft: '1px solid var(--color-border)',
                background: birthInputMode === 'lunar' ? 'var(--color-accent-dark)' : 'transparent',
                color: birthInputMode === 'lunar' ? '#fff' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '14px',
                transition: 'all 0.2s',
                textAlign: 'center'
              }}
              onClick={() => setBirthInputMode('lunar')}
            >
              农历录入
            </button>
          </div>

          <div className="date-group" style={{ padding: '16px', background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)' }}>
            {birthInputMode === 'solar' ? (
              // 公历下拉选择
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', width: '40px', textAlign: 'right' }}>公历:</span>
                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthYear}
                    onChange={(e) => handleSolarChange(parseInt(e.target.value), sBirthMonth, sBirthDay)}
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <span>年</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthMonth}
                    onChange={(e) => handleSolarChange(sBirthYear, parseInt(e.target.value), sBirthDay)}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <span>月</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthDay}
                    onChange={(e) => handleSolarChange(sBirthYear, sBirthMonth, parseInt(e.target.value))}
                  >
                    {solarDaysList.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <span>日</span>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', width: '40px', textAlign: 'right' }}>时间:</span>
                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthHour}
                    onChange={(e) => setSBirthHour(e.target.value)}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <span>时</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthMin}
                    onChange={(e) => setSBirthMin(e.target.value)}
                  >
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <span>分</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthSec}
                    onChange={(e) => setSBirthSec(e.target.value)}
                  >
                    {MINUTES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <span>秒</span>
                </div>

                {lBirthYear && (
                  <div style={{ marginTop: '4px', fontSize: '14px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                    <span>推算农历：</span>
                    <strong style={{ color: 'var(--color-accent)' }}>
                      {formatLunarDate({
                        year: lBirthYear,
                        month: lBirthMonth,
                        day: lBirthDay,
                        isLeap: lBirthIsLeap,
                        monthChinese: Lunar.fromYmd(lBirthYear, lBirthIsLeap ? -lBirthMonth : lBirthMonth, lBirthDay).getMonthInChinese(),
                        dayChinese: Lunar.fromYmd(lBirthYear, lBirthIsLeap ? -lBirthMonth : lBirthMonth, lBirthDay).getDayInChinese(),
                      })}
                    </strong>
                  </div>
                )}
              </div>
            ) : (
              // 农历下拉选择
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', width: '40px', textAlign: 'right' }}>农历:</span>
                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={lBirthYear}
                    onChange={(e) => handleLunarChange(parseInt(e.target.value), lBirthMonth, lBirthIsLeap, lBirthDay)}
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <span>年</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={lBirthIsLeap ? `leap-${lBirthMonth}` : `${lBirthMonth}`}
                    onChange={(e) => {
                      const val = e.target.value;
                      const isLeap = val.startsWith('leap-');
                      const monthVal = isLeap ? parseInt(val.replace('leap-', '')) : parseInt(val);
                      handleLunarChange(lBirthYear, monthVal, isLeap, lBirthDay);
                    }}
                  >
                    {lunarMonthsOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <span>月</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={lBirthDay}
                    onChange={(e) => handleLunarChange(lBirthYear, lBirthMonth, lBirthIsLeap, parseInt(e.target.value))}
                  >
                    {lunarDaysList.map((d) => (
                      <option key={d} value={d}>{getLunarDayName(d)}</option>
                    ))}
                  </select>
                  <span>日</span>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', width: '40px', textAlign: 'right' }}>时间:</span>
                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthHour}
                    onChange={(e) => setSBirthHour(e.target.value)}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <span>时</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthMin}
                    onChange={(e) => setSBirthMin(e.target.value)}
                  >
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <span>分</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sBirthSec}
                    onChange={(e) => setSBirthSec(e.target.value)}
                  >
                    {MINUTES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <span>秒</span>
                </div>

                {sBirthYear && (
                  <div style={{ marginTop: '4px', fontSize: '14px', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                    <span>推算公历：</span>
                    <strong style={{ color: 'var(--color-accent)' }}>
                      {sBirthYear}年{sBirthMonth}月{sBirthDay}日
                    </strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 存活状态 */}
        <div className="alive-toggle" style={{ margin: '16px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isAlive}
              onChange={(e) => setIsAlive(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
            />
            <span style={{ fontSize: '15px', fontWeight: '500' }}>在世</span>
          </label>
        </div>

        {/* 逝世日期公历选择 */}
        {!isAlive && (
          <div className="form-group">
            <label className="form-label">逝世日期（公历）</label>
            <div className="date-group" style={{ padding: '16px', background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', width: '40px', textAlign: 'right' }}>公历:</span>
                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sDeathYear}
                    onChange={(e) => setSDeathYear(parseInt(e.target.value))}
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <span>年</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sDeathMonth}
                    onChange={(e) => setSDeathMonth(parseInt(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <span>月</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sDeathDay}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const max = getSolarDaysInMonth(sDeathYear, sDeathMonth);
                      setSDeathDay(val > max ? max : val);
                    }}
                  >
                    {deathSolarDaysList.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <span>日</span>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', width: '40px', textAlign: 'right' }}>时间:</span>
                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sDeathHour}
                    onChange={(e) => setSDeathHour(e.target.value)}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <span>时</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sDeathMin}
                    onChange={(e) => setSDeathMin(e.target.value)}
                  >
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <span>分</span>

                  <select
                    style={{ width: '100px', textAlign: 'center' }}
                    className="form-input date-number-input"
                    value={sDeathSec}
                    onChange={(e) => setSDeathSec(e.target.value)}
                  >
                    {MINUTES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <span>秒</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">出生地</label>
          <div className="form-row" style={{ flexWrap: 'wrap' }}>
            <select
              className="form-input"
              value={placeProvince}
              onChange={(e) => {
                setPlaceProvince(e.target.value);
                setPlaceCity('');
                setPlaceArea('');
                setPlaceTown('');
              }}
              style={{ flex: '1 1 120px' }}
            >
              <option value="">选择省份</option>
              <option disabled>──────</option>
              {Object.keys(REGIONS)
                .filter(p => p !== '国外')
                .map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              <option disabled>──────</option>
              <option value="国外">国外</option>
            </select>
            {placeProvince === '国外' ? (
              <input
                type="text"
                className="form-input"
                value={placeDetail}
                onChange={(e) => setPlaceDetail(e.target.value)}
                placeholder="国家/地区 + 详细地址"
                style={{ flex: '3 1 360px' }}
              />
            ) : (
              <>
                <select
                  className="form-input"
                  value={placeCity}
                  onChange={(e) => {
                    setPlaceCity(e.target.value);
                    setPlaceArea('');
                    setPlaceTown('');
                  }}
                  disabled={!placeProvince}
                  style={{ flex: '1 1 120px' }}
                >
                  <option value="">选择市/州</option>
                  <option disabled>──────</option>
                  {placeProvince && REGIONS[placeProvince] &&
                    Object.keys(REGIONS[placeProvince]).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                </select>
                <select
                  className="form-input"
                  value={placeArea}
                  onChange={(e) => {
                    setPlaceArea(e.target.value);
                    setPlaceTown('');
                  }}
                  disabled={!placeCity}
                  style={{ flex: '1 1 120px' }}
                >
                  <option value="">选择县/区</option>
                  <option disabled>──────</option>
                  {placeProvince && placeCity && REGIONS[placeProvince]?.[placeCity] &&
                    Object.keys(REGIONS[placeProvince][placeCity]).map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                </select>
                <select
                  className="form-input"
                  value={placeTown}
                  onChange={(e) => setPlaceTown(e.target.value)}
                  disabled={!placeArea}
                  style={{ flex: '1 1 120px' }}
                >
                  <option value="">选择乡镇/街道</option>
                  <option disabled>──────</option>
                  {placeProvince && placeCity && placeArea &&
                    REGIONS[placeProvince]?.[placeCity]?.[placeArea]?.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                </select>
                <input
                  type="text"
                  className="form-input"
                  value={placeDetail}
                  onChange={(e) => setPlaceDetail(e.target.value)}
                  placeholder="详细地址（村/路/门牌号，选填）"
                  style={{ flex: '2 1 240px' }}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* 关系选择 */}
      <div className="form-section">
        <div className="form-section-title">家庭关系</div>
        <div className="relation-selector-dynamic">
          
          {/* 直系生父母 */}
          <div className="relation-group-title">生父母</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="relation-item-dynamic">
              <span className="relation-label-dynamic">父亲</span>
              <select className="relation-select-dynamic" value={fatherId} onChange={(e) => setFatherId(e.target.value)}>
                <option value="">未设置</option>
                {availablePersons.filter((p) => p.gender === 'male').map((p) => (
                  <option key={p.id} value={p.id}>{getFullName(p.surname, p.givenName)}</option>
                ))}
              </select>
            </div>
            <div className="relation-item-dynamic">
              <span className="relation-label-dynamic">母亲</span>
              <select className="relation-select-dynamic" value={motherId} onChange={(e) => setMotherId(e.target.value)}>
                <option value="">未设置</option>
                {availablePersons.filter((p) => p.gender === 'female').map((p) => (
                  <option key={p.id} value={p.id}>{getFullName(p.surname, p.givenName)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 养父母（动态展现） */}
          {(adoptiveFatherIds.length > 0 || adoptiveMotherIds.length > 0) && (
            <>
              <div className="relation-group-title">养父母</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {adoptiveFatherIds.map((afId, index) => (
                    <div key={`af-${index}`} className="relation-item-dynamic">
                      <span className="relation-label-dynamic">养父</span>
                      <select
                        className="relation-select-dynamic"
                        value={afId}
                        onChange={(e) => {
                          const newIds = [...adoptiveFatherIds];
                          newIds[index] = e.target.value;
                          setAdoptiveFatherIds(newIds);
                        }}
                      >
                        <option value="">未设置</option>
                        {availablePersons.filter((p) => p.gender === 'male').map((p) => (
                          <option key={p.id} value={p.id}>{getFullName(p.surname, p.givenName)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="relation-delete-btn"
                        title="移除养父关系"
                        onClick={() => {
                          setAdoptiveFatherIds(adoptiveFatherIds.filter((_, i) => i !== index));
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {adoptiveMotherIds.map((amId, index) => (
                    <div key={`am-${index}`} className="relation-item-dynamic">
                      <span className="relation-label-dynamic">养母</span>
                      <select
                        className="relation-select-dynamic"
                        value={amId}
                        onChange={(e) => {
                          const newIds = [...adoptiveMotherIds];
                          newIds[index] = e.target.value;
                          setAdoptiveMotherIds(newIds);
                        }}
                      >
                        <option value="">未设置</option>
                        {availablePersons.filter((p) => p.gender === 'female').map((p) => (
                          <option key={p.id} value={p.id}>{getFullName(p.surname, p.givenName)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="relation-delete-btn"
                        title="移除养母关系"
                        onClick={() => {
                          setAdoptiveMotherIds(adoptiveMotherIds.filter((_, i) => i !== index));
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 配偶 */}
          <div className="relation-group-title">配偶</div>
          {spouseEntries.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', paddingLeft: '8px', fontStyle: 'italic', marginBottom: '12px' }}>
              暂未关联配偶，点击下方按钮可动态添加。
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {spouseEntries.map((entry, index) => (
                <div key={`spouse-${index}`} className="relation-item-dynamic" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span className="relation-label-dynamic" style={{ minWidth: '40px' }}>配偶</span>
                  <select
                    className="relation-select-dynamic"
                    style={{ flex: 2 }}
                    value={entry.id}
                    onChange={(e) => {
                      const newEntries = [...spouseEntries];
                      newEntries[index] = { ...newEntries[index], id: e.target.value };
                      setSpouseEntries(newEntries);
                    }}
                  >
                    <option value="">选择人员...</option>
                    {availablePersons.map((p) => (
                      <option key={p.id} value={p.id}>{getFullName(p.surname, p.givenName)}</option>
                    ))}
                  </select>
                  <select
                    className="relation-select-dynamic"
                    style={{ flex: 1, minWidth: '80px' }}
                    value={entry.type}
                    onChange={(e) => {
                      const newEntries = [...spouseEntries];
                      newEntries[index] = { ...newEntries[index], type: e.target.value as SpouseRelationType };
                      setSpouseEntries(newEntries);
                    }}
                  >
                    <option value="married">已婚</option>
                    <option value="divorced">离异</option>
                    <option value="deceased">已故</option>
                  </select>
                  <button
                    type="button"
                    className="relation-delete-btn"
                    title="移除配偶关系"
                    onClick={() => {
                      setSpouseEntries(spouseEntries.filter((_, i) => i !== index));
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 子女 */}
          <div className="relation-group-title">子女</div>
          {childEntries.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', paddingLeft: '8px', fontStyle: 'italic', marginBottom: '12px' }}>
              暂未关联子女，点击下方按钮可动态添加。
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {childEntries.map((entry, index) => (
                <div key={`child-${index}`} className="relation-item-dynamic" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <span className="relation-label-dynamic" style={{ minWidth: '40px' }}>子女</span>
                  <select
                    className="relation-select-dynamic"
                    style={{ flex: 2 }}
                    value={entry.id}
                    onChange={(e) => {
                      const newEntries = [...childEntries];
                      newEntries[index] = { ...newEntries[index], id: e.target.value };
                      setChildEntries(newEntries);
                    }}
                  >
                    <option value="">选择人员...</option>
                    {availablePersons.map((p) => (
                      <option key={p.id} value={p.id}>{getFullName(p.surname, p.givenName)}</option>
                    ))}
                  </select>
                  <select
                    className="relation-select-dynamic"
                    style={{ flex: 1, minWidth: '80px' }}
                    value={entry.type}
                    onChange={(e) => {
                      const newEntries = [...childEntries];
                      newEntries[index] = { ...newEntries[index], type: e.target.value };
                      setChildEntries(newEntries);
                    }}
                  >
                    <option value="biological">亲生</option>
                    <option value="adopted">养子/女</option>
                    <option value="step">继子/女</option>
                  </select>
                  <button
                    type="button"
                    className="relation-delete-btn"
                    title="移除子女关系"
                    onClick={() => {
                      setChildEntries(childEntries.filter((_, i) => i !== index));
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 兄弟姐妹列表 */}
          <div className="relation-group-title">兄弟姐妹</div>
          {siblingIds.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', paddingLeft: '8px', fontStyle: 'italic', marginBottom: '12px' }}>
              暂未关联兄弟姐妹，点击下方按钮可动态添加。
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {siblingIds.map((sibId, index) => {
                const tempPersons = getTempPersons();
                const currentPersonId = id && id !== 'new' ? id : 'temp-new-id';
                const rankText = sibId ? getSiblingRank(sibId, tempPersons, currentPersonId) : '';
                return (
                  <div key={index} className="relation-item-dynamic">
                    <span className="relation-label-dynamic">手足</span>
                    <select
                      className="relation-select-dynamic"
                      value={sibId}
                      onChange={(e) => {
                        const newSibs = [...siblingIds];
                        newSibs[index] = e.target.value;
                        setSiblingIds(newSibs);
                      }}
                    >
                      <option value="">请选择人员...</option>
                      {availablePersons.map((p) => (
                        <option key={p.id} value={p.id}>
                          {getFullName(p.surname, p.givenName)}
                        </option>
                      ))}
                    </select>
                    {rankText && (
                      <span className="relation-rank-badge">{rankText}</span>
                    )}
                    <button
                      type="button"
                      className="relation-delete-btn"
                      title="移除兄弟姐妹关系"
                      onClick={() => {
                        const newSibs = siblingIds.filter((_, i) => i !== index);
                        setSiblingIds(newSibs);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 增加关系按钮操作区 */}
          <div className="relation-add-wrapper">
            <button
              type="button"
              className="relation-add-btn"
              onClick={() => setShowRelationMenu(!showRelationMenu)}
            >
              <span>➕</span> 增加家庭关系成员...
            </button>
            {showRelationMenu && (
              <div className="relation-menu-dropdown">
                <button
                  type="button"
                  className="relation-menu-item"
                  onClick={() => {
                    setAdoptiveFatherIds([...adoptiveFatherIds, '']);
                    setShowRelationMenu(false);
                  }}
                >
                  增加 养父
                </button>
                <button
                  type="button"
                  className="relation-menu-item"
                  onClick={() => {
                    setAdoptiveMotherIds([...adoptiveMotherIds, '']);
                    setShowRelationMenu(false);
                  }}
                >
                  增加 养母
                </button>
                <button
                  type="button"
                  className="relation-menu-item"
                  onClick={() => {
                    setSpouseEntries([...spouseEntries, { id: '', type: 'married' }]);
                    setShowRelationMenu(false);
                  }}
                >
                  增加 配偶
                </button>
                <button
                  type="button"
                  className="relation-menu-item"
                  onClick={() => {
                    setChildEntries([...childEntries, { id: '', type: 'biological' }]);
                    setShowRelationMenu(false);
                  }}
                >
                  增加 子女
                </button>
                <button
                  type="button"
                  className="relation-menu-item"
                  onClick={() => {
                    setSiblingIds([...siblingIds, '']);
                    setShowRelationMenu(false);
                  }}
                >
                  增加 兄弟姐妹
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 个人简介 */}
      <div className="form-section">
        <div className="form-section-title">个人简介</div>
        <div className="form-group">
          <textarea
            className="form-textarea"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="记录这个人的故事..."
            rows={4}
          />
        </div>
      </div>

      {/* 头像裁剪弹窗 */}
      {cropModalImage && (
        <AvatarCropModal
          imageSrc={cropModalImage}
          onClose={() => setCropModalImage(null)}
          onSave={handleCropSave}
        />
      )}

      {/* 第一人默认视角确认对话框 */}
      {showFirstPersonDialog && (
        <div className="custom-dialog-overlay" onClick={() => { setShowFirstPersonDialog(false); navigate(-1); }}>
          <div className="custom-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <span className="custom-dialog-icon">📌</span>
              <span className="custom-dialog-title">默认视角确认</span>
            </div>
            <div className="custom-dialog-message">
              这是本家谱中创建的第一个人员，将被设置为<strong>默认视角</strong>。
              <br />
              后续所有人员关系（辈分、代际层级等）都将以该人员为基准进行计算与展示，请悉知。
            </div>
            <div className="custom-dialog-buttons">
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowFirstPersonDialog(false); navigate(-1); }}>
                返回
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleConfirmFirstPerson}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
