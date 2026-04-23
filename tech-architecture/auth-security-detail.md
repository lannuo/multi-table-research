# 认证授权与安全设计深度研究

## 概述
本文档深入研究多维表格产品的认证授权和安全设计方案，涵盖 JWT 认证、RBAC 权限、多租户隔离、OWASP 威胁防护、数据加密、审计日志和分享安全。基于已确定的技术栈（React + Next.js / NestJS / PostgreSQL + JSONB / Redis）。

---

## 一、JWT + Refresh Token 认证

### 1.1 核心概念

- **Access Token**: 短生命周期（15-30分钟），Bearer Token，JWT格式
- **Refresh Token**: 长生命周期（7-30天），仅用于获取新 Access Token
- **SPA推荐方案**: Authorization Code Flow + PKCE

JWT 标准 claims:
```
{
  "iss": "https://api.example.com",  // 签发者
  "sub": "user-uuid",                 // 用户ID
  "aud": "https://app.example.com",   // 受众
  "exp": 1713936000,                  // 过期时间
  "iat": 1713935100,                  // 签发时间
  "scope": "table:read table:write",  // 权限范围
  "tid": "tenant-uuid"                // 租户ID
}
```

### 1.2 Refresh Token Rotation（令牌轮换）

每次使用 Refresh Token 换取新 Access Token 时，**同时返回新的 Refresh Token**，旧 Refresh Token 立即失效。

关键安全机制：
1. **Token Family 追踪**: 授权服务器维护同一系列的所有 Refresh Token 的族谱关系
2. **自动重用检测**: 如果已使用过的 Refresh Token 被再次使用（说明被窃取），服务器**立即作废整个 Token Family**
3. **存储安全性**: Rotation 机制下可安全存储在 localStorage

### 1.3 认证流程

```
1. 用户登录 → POST /auth/login
   → 验证 email + password（bcrypt比对, cost >= 12）
   → 返回 { accessToken(15min), refreshToken(7d) }
   → refreshToken 存入 Redis（关联 userId + familyId）

2. Token 刷新 → POST /auth/refresh
   → 验证 refreshToken 是否有效
   → 检查是否已被使用过（重用检测）
   → 作废旧 refreshToken
   → 返回新的 { accessToken, refreshToken }

3. API请求 → Authorization: Bearer <accessToken>
   → JwtStrategy 验证签名和过期时间
   → 注入 req.user = { userId, email, permissions }

4. 登出 → POST /auth/logout
   → 作废整个 Token Family
```

### 1.4 NestJS 实现

```typescript
// jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(JwtStrategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET'),
    });
  }
  async validate(payload: JwtPayload) {
    return { userId: payload.sub, email: payload.email };
  }
}

// auth.controller.ts - Refresh Token Rotation
@Post('refresh')
async refresh(@Body() dto: RefreshTokenDto) {
  const family = await this.tokenService.validateRefreshToken(dto.refreshToken);
  if (!family) throw new UnauthorizedException();

  // 重用检测
  if (family.tokenAlreadyRotated(dto.refreshToken)) {
    await this.tokenService.revokeFamily(family.id);
    throw new UnauthorizedException('Token reuse detected');
  }

  return this.tokenService.rotate(family, dto.refreshToken);
}
```

### 1.5 安全最佳实践

- Access Token 存内存，Refresh Token 存 httpOnly cookie
- JWT_SECRET 至少256位随机字符串，使用 RS256（非对称）更安全
- Rate limiting: `/auth/login` 限制 IP + email 维度
- 密码存储: bcrypt，cost factor >= 12
- WebSocket 认证: 在握手阶段验证 JWT

---

## 二、RBAC 权限体系

### 2.1 六层权限层级

```
层级1: 工作空间(Space)  → 角色: Owner / Admin / Member / Guest
层级2: 文件夹(Folder)   → 继承或覆盖上层权限
层级3: 数据表(Table)    → 角色: Manager / Editor / Commenter / Viewer
层级4: 视图(View)       → 可见性控制
层级5: 行(Row)          → 基于 owner/team 过滤
层级6: 列(Column)       → 字段级读写控制
```

### 2.2 NestJS RBAC 实现

```typescript
// 权限枚举
export enum Permission {
  SPACE_ADMIN = 'space:admin',
  SPACE_INVITE = 'space:invite',
  TABLE_READ = 'table:read',
  TABLE_WRITE = 'table:write',
  TABLE_DELETE = 'table:delete',
  TABLE_SHARE = 'table:share',
  ROW_READ = 'row:read',
  ROW_WRITE = 'row:write',
  COLUMN_READ = 'col:read',
  COLUMN_WRITE = 'col:write',
}

// 自定义装饰器
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata('permissions', permissions);

// 权限 Guard
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Permission[]>('permissions', context.getHandler());
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const spaceId = request.params.spaceId;
    const tableId = request.params.tableId;

    const userPermissions = await this.permissionService
      .getUserPermissions(user.userId, spaceId, tableId);

    return required.every(p => userPermissions.includes(p));
  }
}

// 使用
@Controller('tables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TableController {
  @Post()
  @RequirePermissions(Permission.TABLE_WRITE)
  async createTable() { /* ... */ }
}
```

### 2.3 数据库权限表设计

```sql
-- 角色定义
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  permissions JSONB NOT NULL,  -- ["table:read", "table:write", ...]
  scope VARCHAR(20) NOT NULL   -- space, folder, table, view
);

-- 权限分配
CREATE TABLE resource_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  role_id UUID REFERENCES roles(id),
  resource_type VARCHAR(20),  -- space, folder, table, view
  resource_id UUID,
  granted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role_id, resource_type, resource_id)
);
```

### 2.4 权限继承算法

- 从资源向上追溯: Table → Folder → Space
- 取最高权限（宽松策略）或严格策略
- Notion 模式: 基于 parent 指针递归查找权限

---

## 三、PostgreSQL 行级安全 (RLS) 多租户隔离

### 3.1 核心原理

PostgreSQL RLS 在查询执行时**自动附加过滤条件**，对每行数据评估 USING 表达式。

关键特性：
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` 启用
- 表 Owner 默认不受 RLS 约束（除非 `FORCE ROW LEVEL SECURITY`）
- 多策略组合: Permissive（OR）+ Restrictive（AND）
- `USING` 控制可见行，`WITH CHECK` 控制可写入行

### 3.2 多租户 RLS 实现

```sql
-- 1. 为每张表添加 tenant_id
ALTER TABLE records ADD COLUMN tenant_id UUID NOT NULL;

-- 2. 启用 RLS
ALTER TABLE records ENABLE ROW LEVEL SECURITY;

-- 3. 创建策略
CREATE POLICY tenant_isolation ON records
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- 4. 应用层设置（每次请求开始时）:
-- SET LOCAL app.current_tenant_id = 'uuid-of-tenant';
```

### 3.3 NestJS 集成

```typescript
// 使用事务级设置，确保安全
async withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return this.dataSource.transaction(async (manager) => {
    await manager.query(`SET LOCAL app.current_tenant_id = $1`, [tenantId]);
    return fn();
  });
}
```

### 3.4 多层权限 RLS 策略组合

```sql
-- Permissive: 租户隔离
CREATE POLICY tenant_access ON records
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Restrictive: 行级权限
CREATE POLICY row_owner ON records AS RESTRICTIVE
  USING (
    owner_id = current_setting('app.current_user_id')::UUID
    OR EXISTS (
      SELECT 1 FROM resource_permissions rp
      WHERE rp.resource_id = records.id
      AND rp.user_id = current_setting('app.current_user_id')::UUID
    )
  );
-- 组合效果: tenant_access(OR) AND row_owner(AND)
```

### 3.5 性能注意事项

- RLS 表达式对每行求值，保持表达式简单
- `tenant_id` 必须建立索引
- 子查询策略有竞态条件风险
- 参照完整性检查（外键、唯一约束）会绕过 RLS

---

## 四、OWASP 安全威胁防范

### 4.1 OWASP Top 10 适配

| 排名 | 威胁 | 多维表格场景 | 防御措施 |
|------|------|-------------|---------|
| A01 | 失效的访问控制 | IDOR: 用户A操作用户B的表格 | 资源级权限检查 + RLS |
| A02 | 加密失败 | JSONB字段中的敏感数据明文 | TLS + 字段级加密 |
| A03 | 注入 | JSONB查询中的SQL注入 | 参数化查询 + 输入验证 |
| A04 | 不安全设计 | 分享链接可被枚举 | 不可预测 token + 速率限制 |
| A05 | 安全配置错误 | CORS、调试信息泄露 | 安全headers + 错误处理 |
| A07 | 身份认证失败 | JWT密钥泄露、弱密码 | 强密钥 + MFA |
| A08 | 数据完整性失败 | OT协作中的恶意操作 | 操作验证 + 审计日志 |

### 4.2 JSONB SQL 注入防范

```typescript
// ❌ 危险：直接拼接
const query = `SELECT * FROM records WHERE data->>'${field}' = '${value}'`;

// ✅ 安全：参数化查询
const query = `SELECT * FROM records WHERE data->>$1 = $2`;
await manager.query(query, [field, value]);

// ✅ JSONB 包含查询
createQueryBuilder('record')
  .where(`record.data @> :filter`, { filter: JSON.stringify({ status: 'active' }) })
  .getMany();
```

### 4.3 IDOR 防范

```typescript
// 每个API端点必须验证资源所有权
@Get(':tableId/records')
async getRecords(@Param('tableId') tableId: string, @ReqUser() user: UserPayload) {
  const hasAccess = await this.permissionService.canAccessTable(user.userId, tableId);
  if (!hasAccess) throw new ForbiddenException();
  return this.recordService.findByTable(tableId);
}
```

### 4.4 安全 Headers

```typescript
app.use(helmet());
// Content-Security-Policy: 防XSS
// X-Frame-Options: 防点击劫持
// X-Content-Type-Options: 防MIME嗅探
// Strict-Transport-Security: 强制HTTPS
```

---

## 五、数据加密

### 5.1 三层加密策略

```
层次一: 传输加密 (TLS/HTTPS)
├── 全站 HTTPS，HSTS
├── WebSocket 使用 WSS
└── 数据库连接使用 SSL

层次二: 静态加密 (Encryption at Rest)
├── 文件系统级: LUKS / dm-crypt 全盘加密
├── 云服务: AWS RDS Encryption / Azure TDE
└── pgcrypto 扩展: 字段级加密

层次三: 字段级加密（应用层 AES-256-GCM）
├── 每个租户可使用独立 DEK
└── 密钥由 KMS 管理
```

### 5.2 应用层加密（推荐方案）

```typescript
import * as crypto from 'crypto';

export class FieldEncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer; // 从 KMS/环境变量获取

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
```

### 5.3 密钥管理策略

```
密钥层级:
├── KEK (Key Encryption Key) → 主密钥，存储在 KMS 中
├── DEK (Data Encryption Key) → 数据加密密钥，由 KEK 加密保护
└── 每个租户可使用独立 DEK

推荐方案:
├── 开发/小规模: 环境变量 + 数据库加密存储
├── 中等规模: HashiCorp Vault 或 AWS KMS
└── 企业级: AWS KMS + 自动密钥轮换 + 审计
```

---

## 六、审计日志

### 6.1 数据库设计

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID,
  user_email VARCHAR(255),
  action VARCHAR(50) NOT NULL,     -- CREATE, READ, UPDATE, DELETE, SHARE, LOGIN, EXPORT
  resource_type VARCHAR(30),       -- space, table, record, field, view, automation
  resource_id UUID,
  resource_name VARCHAR(255),
  changes JSONB,                   -- { before: {...}, after: {...} }
  ip_address INET,
  user_agent TEXT,
  request_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs (resource_type, resource_id);
```

### 6.2 NestJS 审计拦截器

```typescript
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const auditEntry = {
      userId: request.user?.userId,
      action: `${request.method}:${context.getHandler().name}`,
      resourceType: request.params.tableId ? 'table' : 'space',
      resourceId: request.params.tableId || request.params.spaceId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      timestamp: new Date(),
    };

    return next.handle().pipe(
      tap(() => this.auditService.log({ ...auditEntry, status: 'success' })),
      catchError((error) => {
        this.auditService.log({ ...auditEntry, status: 'failed', error: error.message });
        throw error;
      }),
    );
  }
}
```

### 6.3 SOC 2 合规关键要求

| 控制域 | 要求 | 实现方式 |
|--------|------|---------|
| CC6.1 逻辑访问 | 基于角色的访问控制 | RBAC + RLS |
| CC6.2 访问撤销 | 及时撤销离职人员权限 | SCIM集成 + 自动化 |
| CC7.1 检测监控 | 异常活动检测 | 审计日志 + 告警 |
| CC7.2 事件响应 | 安全事件处理流程 | 自动化通知 + 升级 |
| CC8.1 变更管理 | 系统变更记录 | Schema migration + GitOps |

### 6.4 日志保留策略

- 实时数据: 最近90天，PostgreSQL
- 归档数据: 1-7年，对象存储 Parquet 格式
- 敏感操作（删除、导出、分享）: 永久保留

---

## 七、分享与外部访问安全

### 7.1 分享链接设计

```typescript
export class SharingService {
  generateShareToken(): string {
    return crypto.randomBytes(20).toString('hex'); // 40字符 hex，不可枚举
  }

  async createShareLink(params: {
    resourceId: string;
    resourceType: 'table' | 'view' | 'form';
    permission: 'view' | 'edit' | 'comment';
    expiresIn?: number;
    password?: string;
    maxUses?: number;
  }) {
    const token = this.generateShareToken();
    const share = {
      token,
      ...params,
      password: params.password
        ? await bcrypt.hash(params.password, 10)
        : null,
    };
    await this.shareRepo.save(share);
    return `https://app.example.com/share/${token}`;
  }
}
```

### 7.2 分享权限表

```sql
CREATE TABLE share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) NOT NULL UNIQUE,
  resource_type VARCHAR(20) NOT NULL,
  resource_id UUID NOT NULL,
  permission VARCHAR(20) NOT NULL DEFAULT 'view',
  password_hash VARCHAR(255),
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  use_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  CONSTRAINT valid_permission CHECK (permission IN ('view', 'edit', 'comment'))
);
CREATE INDEX idx_share_token ON share_links (token) WHERE is_active = TRUE;
```

### 7.3 匿名表单提交安全

```typescript
@Controller('public/forms')
export class PublicFormController {
  @Post(':shareToken/submit')
  @UseGuards(RateLimitGuard)
  @Throttle(10, 60) // 每分钟10次
  async submitForm(@Param('shareToken') token: string, @Body() formData: FormSubmitDto, @Ip() ip: string) {
    // 1. 验证分享链接有效性
    const share = await this.shareService.validateShare(token);
    // 2. 验证密码（如果需要）
    // 3. 验证表单数据格式
    // 4. 写入数据（受限权限）
    // 5. 更新使用计数
  }
}
```

### 7.4 签名 URL（文件下载）

```typescript
export class SignedUrlService {
  generateSignedUrl(fileId: string, expiresIn = 3600): string {
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${fileId}:${expires}`)
      .digest('hex');
    return `/api/files/${fileId}?expires=${expires}&sig=${signature}`;
  }

  verifySignedUrl(fileId: string, expires: number, sig: string): boolean {
    if (Date.now() / 1000 > expires) return false;
    const expected = crypto.createHmac('sha256', this.secret)
      .update(`${fileId}:${expires}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }
}
```

---

## 八、安全实施路径

```
阶段1 (MVP):
├── JWT + Refresh Token Rotation 认证
├── 基础 RBAC（Space/Table两层角色）
├── 应用层权限检查（Guard + Decorator）
├── 参数化查询防 SQL 注入
├── Helmet + HTTPS + Rate Limiting
└── 基础审计日志

阶段2 (产品化):
├── PostgreSQL RLS 多租户隔离
├── 完善六层权限体系
├── 字段级加密（AES-256-GCM）
├── 分享链接 + 匿名表单
├── 密钥管理（Vault/KMS）
└── 详细审计日志 + 异常检测

阶段3 (企业级):
├── SOC 2 合规建设
├── SSO/SAML 集成
├── MFA 多因素认证
├── 日志归档 + 安全事件响应
└── 渗透测试 + 安全审计
```

---

## 参考链接

- [Auth0 - Refresh Tokens](https://auth0.com/blog/refresh-tokens-what-are-they-and-when-to-use-them/)
- [Auth0 - Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [NestJS Authentication](https://docs.nestjs.com/security/authentication)
- [NestJS Authorization](https://docs.nestjs.com/security/authorization)
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [Aserto - Multi-Tenant RBAC](https://www.aserto.com/blog/authorization-101-multi-tenant-rbac)
- [AWS S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)
