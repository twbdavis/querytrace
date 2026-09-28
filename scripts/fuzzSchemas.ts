/* Custom schemas for the differential stress test, written the way real
   export tools write them. Each loads through the custom-schema builder. */
import type { SchemaDef } from '../lib/schemas';

export interface FuzzSchema extends SchemaDef {
  /** Report key; `id` stays 'custom' so the runtime applies custom-schema rules. */
  key: string;
}

const SHOP_MYSQL = `
-- MySQL dump 10.13  Distrib 8.0.36, for Win64 (x86_64)
-- Host: localhost    Database: shop
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;

DROP TABLE IF EXISTS \`customers\`;
CREATE TABLE \`customers\` (
  \`customer_id\` int NOT NULL AUTO_INCREMENT,
  \`full_name\` varchar(60) NOT NULL,
  \`email\` varchar(80) DEFAULT NULL,
  \`tier\` enum('bronze','silver','gold') NOT NULL DEFAULT 'bronze',
  \`joined_on\` date NOT NULL,
  \`referred_by\` int DEFAULT NULL,
  PRIMARY KEY (\`customer_id\`),
  UNIQUE KEY \`uq_email\` (\`email\`),
  KEY \`idx_tier\` (\`tier\`),
  CONSTRAINT \`fk_referrer\` FOREIGN KEY (\`referred_by\`) REFERENCES \`customers\` (\`customer_id\`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE \`products\` (
  \`product_id\` int NOT NULL,
  \`sku\` varchar(12) NOT NULL,
  \`name\` varchar(60) NOT NULL,
  \`category\` varchar(30) NOT NULL,
  \`price\` decimal(8,2) NOT NULL,
  \`stock\` int unsigned NOT NULL DEFAULT '0',
  \`discontinued\` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (\`product_id\`),
  UNIQUE KEY \`uq_sku\` (\`sku\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='catalogue';

CREATE TABLE \`orders\` (
  \`order_id\` int NOT NULL AUTO_INCREMENT,
  \`customer_id\` int NOT NULL,
  \`ordered_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`status\` enum('new','paid','shipped','cancelled') NOT NULL DEFAULT 'new',
  \`note\` text,
  PRIMARY KEY (\`order_id\`),
  KEY \`fk_orders_customer\` (\`customer_id\`),
  CONSTRAINT \`fk_orders_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`customer_id\`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4;

CREATE TABLE \`order_items\` (
  \`order_id\` int NOT NULL,
  \`product_id\` int NOT NULL,
  \`qty\` int NOT NULL,
  \`unit_price\` decimal(8,2) NOT NULL,
  PRIMARY KEY (\`order_id\`,\`product_id\`),
  KEY \`fk_items_product\` (\`product_id\`),
  CONSTRAINT \`fk_items_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`order_id\`) ON DELETE CASCADE,
  CONSTRAINT \`fk_items_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`product_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

# customers (7): one gold, two silver, rest bronze; #7 never ordered
INSERT INTO \`customers\` VALUES
(1,'Ada O\\'Neill','ada@example.test','gold','2025-01-15',NULL),
(2,'Bram Kowalczyk','bram@example.test','silver','2025-02-03',1),
(3,'Chiara Bassi',NULL,'bronze','2025-02-20',1),
(4,'Dagny Þórsdóttir','dagny@example.test','silver','2025-03-11',2),
(5,'Emeka Obi','emeka@example.test','bronze','2025-04-08',NULL),
(6,'Farah Nasser','farah@example.test','bronze','2025-05-30',4),
(7,'Gus Lindqvist',NULL,'bronze','2025-06-14',NULL);

INSERT INTO \`products\` (\`product_id\`, \`sku\`, \`name\`, \`category\`, \`price\`, \`stock\`, \`discontinued\`) VALUES
(101,'MUG-001','Stoneware Mug','kitchen',14.50,120,0),
(102,'MUG-002','Travel Mug','kitchen',22.00,35,0),
(103,'TEA-010','Loose Leaf Tea 100g','pantry',9.75,200,0),
(104,'TEA-011','Tea Infuser','kitchen',6.20,0,0),
(105,'BK-201','Field Notebook','stationery',5.00,500,0),
(106,'BK-202','Fountain Pen','stationery',48.90,12,0),
(107,'LMP-300','Desk Lamp','home',64.00,8,1),
(108,'CND-400','Beeswax Candle','home',11.30,60,0);

INSERT INTO \`orders\` VALUES
(1,1,'2025-03-01 10:15:00','shipped',NULL),
(2,1,'2025-03-18 14:02:00','shipped','gift wrap'),
(3,2,'2025-03-20 09:00:00','paid',NULL),
(4,3,'2025-04-02 16:45:00','cancelled','customer changed mind'),
(5,4,'2025-04-15 11:30:00','shipped',NULL),
(6,2,'2025-05-01 08:20:00','new',NULL),
(7,5,'2025-05-09 19:10:00','paid',NULL),
(8,6,'2025-06-01 12:00:00','shipped','leave at door'),
(9,1,'2025-06-20 15:55:00','new',NULL),
(10,4,'2025-07-04 10:10:00','paid',NULL);

INSERT INTO \`order_items\` VALUES
(1,101,2,14.50),(1,103,1,9.75),
(2,106,1,48.90),(2,105,3,5.00),
(3,102,1,22.00),(3,104,2,6.20),
(4,107,1,64.00),
(5,101,4,14.50),(5,108,2,11.30),
(6,103,2,9.75),
(7,105,10,5.00),(7,106,1,48.90),
(8,108,3,11.30),(8,101,1,14.50),(8,102,1,22.00),
(10,103,1,9.75),(10,105,2,5.00);
SET FOREIGN_KEY_CHECKS=1;
COMMIT;
`;

const LIBRARY_PG = `
--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
\\connect library

CREATE TABLE public.author (
    author_id integer NOT NULL,
    name text NOT NULL,
    born_year integer,
    country character varying(40)
);
CREATE TABLE public.book (
    book_id integer NOT NULL,
    title text NOT NULL,
    author_id integer,
    published integer,
    pages integer,
    rating numeric(3,1),
    CONSTRAINT book_published_check CHECK ((published > 1400))
);
CREATE SEQUENCE public.book_book_id_seq START WITH 1 INCREMENT BY 1;
ALTER TABLE ONLY public.book ALTER COLUMN book_id SET DEFAULT nextval('public.book_book_id_seq'::regclass);
CREATE TABLE public.member (
    member_id integer NOT NULL,
    name text,
    email text,
    joined date DEFAULT now()
);
CREATE TABLE public.loan (
    loan_id integer NOT NULL,
    book_id integer NOT NULL,
    member_id integer NOT NULL,
    loaned_on date NOT NULL,
    returned_on date
);
CREATE TABLE public.import_staging (
    rowid integer,
    raw_title text,
    raw_author text
);

COPY public.author (author_id, name, born_year, country) FROM stdin;
\\.

INSERT INTO public.author VALUES (1, E'Ngũgĩ wa Thiong\\'o', 1938, 'Kenya');
INSERT INTO public.author VALUES (2, 'Ursula K. Le Guin', 1929, 'United States');
INSERT INTO public.author VALUES (3, 'Italo Calvino', 1923, 'Italy');
INSERT INTO public.author VALUES (4, 'Tove Jansson', 1914, 'Finland');
INSERT INTO public.author VALUES (5, 'Anonymous', NULL, NULL);
INSERT INTO public.book VALUES (1, 'A Grain of Wheat', 1, 1967, 247, 4.2);
INSERT INTO public.book VALUES (2, 'The Dispossessed', 2, 1974, 341, 4.5);
INSERT INTO public.book VALUES (3, 'Invisible Cities', 3, 1972, 165, 4.4);
INSERT INTO public.book VALUES (4, 'Moominsummer Madness', 4, 1954, 160, 4.1);
INSERT INTO public.book VALUES (5, 'The Left Hand of Darkness', 2, 1969, 304, 4.3);
INSERT INTO public.book VALUES (6, 'Beowulf', NULL, 1815, 213, 3.9);
INSERT INTO public.book VALUES (7, 'If on a winter''s night a traveler', 3, 1979, 260, NULL);
INSERT INTO public.member VALUES (10, 'Priya Raman', 'priya@lib.test', '2024-09-01');
INSERT INTO public.member VALUES (11, 'Hugo Meier', NULL, '2024-11-12');
INSERT INTO public.member VALUES (12, 'Wanjiru Kamau', 'wanjiru@lib.test', '2025-01-20');
INSERT INTO public.member VALUES (13, 'Sven Lund', 'sven@lib.test', '2025-03-05');
INSERT INTO public.loan VALUES (500, 1, 10, '2025-04-01', '2025-04-20');
INSERT INTO public.loan VALUES (501, 2, 10, '2025-04-22', NULL);
INSERT INTO public.loan VALUES (502, 3, 11, '2025-05-02', '2025-05-30');
INSERT INTO public.loan VALUES (503, 5, 12, '2025-05-10', NULL);
INSERT INTO public.loan VALUES (504, 1, 12, '2025-06-01', '2025-06-15');
INSERT INTO public.loan VALUES (505, 4, 11, '2025-06-03', NULL);
INSERT INTO public.loan VALUES (506, 6, 10, '2025-06-20', NULL);
INSERT INTO public.import_staging VALUES (1, 'the dispossessed', 'le guin');
INSERT INTO public.import_staging VALUES (2, 'INVISIBLE CITIES', 'calvino');
INSERT INTO public.import_staging VALUES (2, 'Invisible Cities', 'Calvino');
INSERT INTO public.import_staging VALUES (NULL, 'untitled', NULL);

ALTER TABLE ONLY public.author ADD CONSTRAINT author_pkey PRIMARY KEY (author_id);
ALTER TABLE ONLY public.book ADD CONSTRAINT book_pkey PRIMARY KEY (book_id);
ALTER TABLE ONLY public.member ADD CONSTRAINT member_pkey PRIMARY KEY (member_id);
ALTER TABLE ONLY public.loan ADD CONSTRAINT loan_pkey PRIMARY KEY (loan_id);
ALTER TABLE ONLY public.book ADD CONSTRAINT book_author_fk FOREIGN KEY (author_id) REFERENCES public.author(author_id) ON DELETE SET NULL;
ALTER TABLE ONLY public.loan ADD CONSTRAINT loan_book_fk FOREIGN KEY (book_id) REFERENCES public.book(book_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.loan ADD CONSTRAINT loan_member_fk FOREIGN KEY (member_id) REFERENCES public.member(member_id);
CREATE INDEX loan_member_idx ON public.loan USING btree (member_id);
`;

const HR_MSSQL = `
USE [HrDemo]
GO
/****** Object:  Table [dbo].[Department]    Script Date: 3/2/2026 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Department](
	[DeptId] [int] IDENTITY(1,1) NOT NULL,
	[DeptName] [nvarchar](50) NOT NULL,
	[Budget] [money] NULL,
 CONSTRAINT [PK_Department] PRIMARY KEY CLUSTERED
(
	[DeptId] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
CREATE TABLE [dbo].[Employee](
	[EmpId] [int] NOT NULL,
	[FirstName] [nvarchar](40) NULL,
	[LastName] [nvarchar](40) NOT NULL,
	[DeptId] [int] NULL,
	[ManagerId] [int] NULL,
	[Salary] [decimal](10, 2) NULL,
	[HiredOn] [date] NULL,
	[IsActive] [bit] NOT NULL,
	[Notes] [nvarchar](max) NULL,
 CONSTRAINT [PK_Employee] PRIMARY KEY CLUSTERED ([EmpId] ASC) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
CREATE TABLE [dbo].[Project](
	[ProjectId] [int] NOT NULL,
	[Name] [nvarchar](60) NOT NULL,
	[DeptId] [int] NULL,
	[StartDate] [date] NULL,
	[Hours] [int] NULL,
 CONSTRAINT [PK_Project] PRIMARY KEY CLUSTERED ([ProjectId] ASC)
)
GO
CREATE TABLE [dbo].[Assignment](
	[EmpId] [int] NOT NULL,
	[ProjectId] [int] NOT NULL,
	[Role] [nvarchar](30) NULL,
	[Pct] [int] NOT NULL DEFAULT ((100)),
 CONSTRAINT [PK_Assignment] PRIMARY KEY CLUSTERED ([EmpId] ASC, [ProjectId] ASC)
)
GO
ALTER TABLE [dbo].[Employee] ADD  CONSTRAINT [DF_Employee_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
SET IDENTITY_INSERT [dbo].[Department] ON
GO
INSERT [dbo].[Department] ([DeptId], [DeptName], [Budget]) VALUES (1, N'Engineering', 250000.0000)
INSERT [dbo].[Department] ([DeptId], [DeptName], [Budget]) VALUES (2, N'Design', 90000.0000)
INSERT [dbo].[Department] ([DeptId], [DeptName], [Budget]) VALUES (3, N'Operations', NULL)
INSERT [dbo].[Department] ([DeptId], [DeptName], [Budget]) VALUES (4, N'Research & Development', 120000.5000)
GO
SET IDENTITY_INSERT [dbo].[Department] OFF
GO
INSERT [dbo].[Employee] ([EmpId], [FirstName], [LastName], [DeptId], [ManagerId], [Salary], [HiredOn], [IsActive], [Notes]) VALUES (100, N'Grace', N'Hopper', 1, NULL, CAST(185000.00 AS Decimal(10, 2)), CAST(N'2019-04-01' AS Date), 1, NULL)
INSERT [dbo].[Employee] ([EmpId], [FirstName], [LastName], [DeptId], [ManagerId], [Salary], [HiredOn], [IsActive], [Notes]) VALUES (101, N'Linus', N'Okafor', 1, 100, CAST(142000.00 AS Decimal(10, 2)), CAST(N'2020-09-14' AS Date), 1, N'on call rota')
INSERT [dbo].[Employee] ([EmpId], [FirstName], [LastName], [DeptId], [ManagerId], [Salary], [HiredOn], [IsActive], [Notes]) VALUES (102, N'Mei', N'Tanaka', 1, 100, CAST(138500.00 AS Decimal(10, 2)), CAST(N'2021-01-11' AS Date), 1, NULL)
INSERT [dbo].[Employee] ([EmpId], [FirstName], [LastName], [DeptId], [ManagerId], [Salary], [HiredOn], [IsActive], [Notes]) VALUES (103, N'Sofia', N'Alvarez', 2, 100, CAST(99000.00 AS Decimal(10, 2)), CAST(N'2021-06-01' AS Date), 1, NULL)
INSERT [dbo].[Employee] ([EmpId], [FirstName], [LastName], [DeptId], [ManagerId], [Salary], [HiredOn], [IsActive], [Notes]) VALUES (104, NULL, N'Bergström', 2, 103, CAST(87000.00 AS Decimal(10, 2)), CAST(N'2022-03-15' AS Date), 0, N'left 2025')
INSERT [dbo].[Employee] ([EmpId], [FirstName], [LastName], [DeptId], [ManagerId], [Salary], [HiredOn], [IsActive], [Notes]) VALUES (105, N'Kwame', N'Mensah', 3, 100, NULL, CAST(N'2023-11-20' AS Date), 1, NULL)
INSERT [dbo].[Employee] ([EmpId], [FirstName], [LastName], [DeptId], [ManagerId], [Salary], [HiredOn], [IsActive], [Notes]) VALUES (106, N'Ivy', N'Chen', NULL, 101, CAST(120000.00 AS Decimal(10, 2)), NULL, 1, N'contractor, no department')
GO
INSERT [dbo].[Project] ([ProjectId], [Name], [DeptId], [StartDate], [Hours]) VALUES (1, N'Billing Rewrite', 1, CAST(N'2025-01-06' AS Date), 1200)
INSERT [dbo].[Project] ([ProjectId], [Name], [DeptId], [StartDate], [Hours]) VALUES (2, N'Brand Refresh', 2, CAST(N'2025-02-10' AS Date), 300)
INSERT [dbo].[Project] ([ProjectId], [Name], [DeptId], [StartDate], [Hours]) VALUES (3, N'Warehouse Audit', 3, CAST(N'2025-03-03' AS Date), NULL)
INSERT [dbo].[Project] ([ProjectId], [Name], [DeptId], [StartDate], [Hours]) VALUES (4, N'Skunkworks', NULL, NULL, 80)
GO
INSERT [dbo].[Assignment] ([EmpId], [ProjectId], [Role], [Pct]) VALUES (100, 1, N'Sponsor', 10)
INSERT [dbo].[Assignment] ([EmpId], [ProjectId], [Role], [Pct]) VALUES (101, 1, N'Lead', 80)
INSERT [dbo].[Assignment] ([EmpId], [ProjectId], [Role], [Pct]) VALUES (102, 1, N'Engineer', 100)
INSERT [dbo].[Assignment] ([EmpId], [ProjectId], [Role], [Pct]) VALUES (103, 2, N'Lead', 50)
INSERT [dbo].[Assignment] ([EmpId], [ProjectId], [Role], [Pct]) VALUES (104, 2, N'Designer', 100)
INSERT [dbo].[Assignment] ([EmpId], [ProjectId], [Role], [Pct]) VALUES (102, 4, NULL, 20)
INSERT [dbo].[Assignment] ([EmpId], [ProjectId], [Role], [Pct]) VALUES (106, 1, N'Engineer', 60)
GO
ALTER TABLE [dbo].[Employee]  WITH CHECK ADD  CONSTRAINT [FK_Employee_Department] FOREIGN KEY([DeptId])
REFERENCES [dbo].[Department] ([DeptId])
GO
ALTER TABLE [dbo].[Employee] CHECK CONSTRAINT [FK_Employee_Department]
GO
ALTER TABLE [dbo].[Employee]  WITH CHECK ADD  CONSTRAINT [FK_Employee_Manager] FOREIGN KEY([ManagerId])
REFERENCES [dbo].[Employee] ([EmpId])
GO
ALTER TABLE [dbo].[Project]  WITH CHECK ADD  CONSTRAINT [FK_Project_Department] FOREIGN KEY([DeptId])
REFERENCES [dbo].[Department] ([DeptId])
GO
ALTER TABLE [dbo].[Assignment]  WITH CHECK ADD  CONSTRAINT [FK_Assignment_Employee] FOREIGN KEY([EmpId])
REFERENCES [dbo].[Employee] ([EmpId]) ON DELETE CASCADE
GO
ALTER TABLE [dbo].[Assignment]  WITH CHECK ADD  CONSTRAINT [FK_Assignment_Project] FOREIGN KEY([ProjectId])
REFERENCES [dbo].[Project] ([ProjectId])
GO
`;

const EDGE_SQLITE = `
CREATE TABLE "Mixed_Case" (
  "Id" INTEGER PRIMARY KEY,
  "Value" REAL,
  "Label" TEXT,
  "Group" TEXT
);
CREATE TABLE empty_table (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE single_row (id INTEGER PRIMARY KEY, note TEXT);
CREATE TABLE "order" (
  order_id INTEGER PRIMARY KEY,
  mixed_id INTEGER REFERENCES "Mixed_Case"("Id"),
  qty TEXT
);
CREATE TABLE keyless (rowid INTEGER, tag TEXT, amount INTEGER);
CREATE TABLE textkey ("Sku Code" TEXT PRIMARY KEY, price INTEGER NOT NULL CHECK (price >= 0));
CREATE TABLE nullable_fk (
  id INTEGER PRIMARY KEY,
  mixed_id INTEGER NULL REFERENCES "Mixed_Case"("Id") ON DELETE SET NULL,
  amount INTEGER
);
INSERT INTO "Mixed_Case" VALUES
  (1, 0.1, 'alpha', 'a'), (2, 0.2, 'beta', 'a'), (3, 0.30000000000000004, 'gamma', 'b'),
  (4, NULL, 'delta', 'b'), (5, -7.5, 'alpha', NULL), (6, 1e10, '', 'c'), (7, 42, 'O''Brien', 'c'),
  (8, 3.5, 'Ñandú 🦤', 'c');
INSERT INTO single_row VALUES (1, 'only');
INSERT INTO "order" VALUES (1, 1, '007'), (2, 1, '10'), (3, 2, '9'), (4, NULL, 'many'), (5, 8, '0');
INSERT INTO keyless VALUES (10, 'x', 5), (10, 'x', 5), (11, 'y', NULL), (NULL, NULL, 0);
INSERT INTO textkey VALUES ('SKU 1', 100), ('sku 1', 200), ('SKU-2', 0), ('', 5);
INSERT INTO nullable_fk VALUES (1, 1, 10), (2, NULL, 20), (3, 3, 30), (4, NULL, NULL), (5, 7, 50);
`;

export const CUSTOM_SCHEMAS: FuzzSchema[] = [
  { key: 'shop_mysql', id: 'custom', name: 'Shop (MySQL dump)', description: '', ddl: SHOP_MYSQL, starterQuery: 'SELECT * FROM customers;' },
  { key: 'library_pg', id: 'custom', name: 'Library (pg_dump)', description: '', ddl: LIBRARY_PG, starterQuery: 'SELECT * FROM author;' },
  { key: 'hr_mssql', id: 'custom', name: 'HR (SSMS script)', description: '', ddl: HR_MSSQL, starterQuery: 'SELECT * FROM Employee;' },
  { key: 'edge_sqlite', id: 'custom', name: 'Edge cases (SQLite)', description: '', ddl: EDGE_SQLITE, starterQuery: 'SELECT * FROM "Mixed_Case";' },
];
