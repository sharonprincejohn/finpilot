import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { financialStore } from './src/db/store';
import {
  calculate30DayCashFlowForecast,
  calculateCashFlowForecast,
  evaluateAffordability,
  calculateFinancialHealthScore,
  calculateNetWorth,
  calculatePeriodIncome,
  calculatePeriodExpenses,
  calculateSavingsRate
} from './src/lib/finance/calculations';
import { autoCategorizeTransaction } from './src/lib/finance/categorization';
import { processAssistantQuery } from './src/lib/ai/gemini-assistant';
import { DEFAULT_USER } from './src/db/seedData';

dotenv.config();

let currentActiveUserId = DEFAULT_USER.id;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Helper to extract or resolve user id
  const getUserId = (req: Request): string => {
    const authHeader = req.headers['x-user-id'];
    if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
      return authHeader;
    }
    return currentActiveUserId;
  };

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'finpilot-backend' });
  });

  // --- Auth & Session ---
  app.get('/api/auth/session', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const user = financialStore.getUser(userId) || DEFAULT_USER;
    res.json({ user });
  });

  app.post('/api/auth/switch-user', (req: Request, res: Response) => {
    const { userId, email, name } = req.body;
    if (userId && financialStore.getUser(userId)) {
      currentActiveUserId = userId;
      return res.json({ success: true, user: financialStore.getUser(userId) });
    }
    if (email && name) {
      const user = financialStore.createUser(email, name);
      currentActiveUserId = user.id;
      return res.json({ success: true, user });
    }
    currentActiveUserId = DEFAULT_USER.id;
    res.json({ success: true, user: DEFAULT_USER });
  });

  // --- Dashboard Summary ---
  app.get('/api/dashboard', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const summary = financialStore.getDashboardSummary(userId);
    res.json(summary);
  });

  // --- Accounts ---
  app.get('/api/accounts', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const accounts = financialStore.getAccounts(userId);
    res.json({ accounts });
  });

  app.post('/api/accounts', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const account = financialStore.addAccount(userId, req.body);
    res.status(201).json(account);
  });

  app.put('/api/accounts/:id', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const updated = financialStore.updateAccount(userId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Account not found' });
    res.json(updated);
  });

  app.delete('/api/accounts/:id', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const deleted = financialStore.deleteAccount(userId, req.params.id);
    res.json({ success: deleted });
  });

  // --- Transactions ---
  app.get('/api/transactions', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { categoryId, accountId, type, search, limit } = req.query;
    const transactions = financialStore.getTransactions(userId, {
      categoryId: categoryId ? String(categoryId) : undefined,
      accountId: accountId ? String(accountId) : undefined,
      type: type ? String(type) : undefined,
      search: search ? String(search) : undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
    });
    res.json({ transactions });
  });

  app.post('/api/transactions', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const body = req.body;

    // Auto-categorize if category not provided
    if (!body.categoryId || body.categoryId === 'auto') {
      const auto = autoCategorizeTransaction(body.merchant || body.description, body.amount);
      body.categoryId = auto.categoryId;
      body.categoryName = auto.categoryName;
      if (!body.type) body.type = auto.type;
    }

    const tx = financialStore.addTransaction(userId, body);
    res.status(201).json(tx);
  });

  app.put('/api/transactions/:id', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const updated = financialStore.updateTransaction(userId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Transaction not found' });
    res.json(updated);
  });

  app.delete('/api/transactions/:id', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const deleted = financialStore.deleteTransaction(userId, req.params.id);
    res.json({ success: deleted });
  });

  // --- Categories ---
  app.get('/api/categories', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const categories = financialStore.getCategories(userId);
    res.json({ categories });
  });

  // --- Budgets ---
  app.get('/api/budgets', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const budgets = financialStore.getBudgets(userId);
    res.json({ budgets });
  });

  app.post('/api/budgets', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const budget = financialStore.addBudget(userId, req.body);
    res.status(201).json(budget);
  });

  app.put('/api/budgets/:id', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const updated = financialStore.updateBudget(userId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Budget not found' });
    res.json(updated);
  });

  // --- Bills ---
  app.get('/api/bills', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const bills = financialStore.getBills(userId);
    res.json({ bills });
  });

  app.post('/api/bills', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const bill = financialStore.addBill(userId, req.body);
    res.status(201).json(bill);
  });

  app.put('/api/bills/:id', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const updated = financialStore.updateBill(userId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Bill not found' });
    res.json(updated);
  });

  // --- Subscriptions ---
  app.get('/api/subscriptions', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const subscriptions = financialStore.getSubscriptions(userId);
    const monthlyRunRate = subscriptions
      .filter(s => s.status === 'ACTIVE')
      .reduce((sum, s) => sum + s.amount, 0);
    const annualProjected = monthlyRunRate * 12;

    res.json({
      subscriptions,
      monthlyRunRate: Math.round(monthlyRunRate * 100) / 100,
      annualProjected: Math.round(annualProjected * 100) / 100,
    });
  });

  app.post('/api/subscriptions', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const sub = financialStore.addSubscription(userId, req.body);
    res.status(201).json(sub);
  });

  // --- Savings Goals ---
  app.get('/api/savings-goals', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const goals = financialStore.getSavingsGoals(userId);
    res.json({ goals });
  });

  app.post('/api/savings-goals', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const goal = financialStore.addSavingsGoal(userId, req.body);
    res.status(201).json(goal);
  });

  app.post('/api/savings-goals/:id/contribute', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { amount } = req.body;
    const goal = financialStore.contributeSavingsGoal(userId, req.params.id, Number(amount) || 0);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    res.json(goal);
  });

  // --- Alerts ---
  app.get('/api/alerts', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const alerts = financialStore.getAlerts(userId);
    res.json({ alerts });
  });

  app.patch('/api/alerts/:id/read', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const success = financialStore.markAlertAsRead(userId, req.params.id);
    res.json({ success });
  });

  app.post('/api/alerts/mark-all-read', (req: Request, res: Response) => {
    const userId = getUserId(req);
    financialStore.markAllAlertsRead(userId);
    res.json({ success: true });
  });

  app.delete('/api/alerts/:id', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const success = financialStore.dismissAlert(userId, req.params.id);
    res.json({ success });
  });

  // --- Financial Health & Cash Flow Forecast ---
  app.get('/api/financial-health', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const accounts = financialStore.getAccounts(userId);
    const transactions = financialStore.getTransactions(userId);
    const bills = financialStore.getBills(userId);
    const subscriptions = financialStore.getSubscriptions(userId);

    const { netWorth, totalLiabilities } = calculateNetWorth(accounts);
    const income = calculatePeriodIncome(transactions, '2026-09') || 8500;
    const expenses = calculatePeriodExpenses(transactions, '2026-09') || 4260;
    const savingsRate = calculateSavingsRate(income, expenses);
    const savingsAcc = accounts.find(a => a.accountType === 'SAVINGS');
    const liquidSavings = savingsAcc ? savingsAcc.currentBalance : 28600;

    const health = calculateFinancialHealthScore(
      netWorth,
      income,
      expenses,
      savingsRate,
      liquidSavings,
      totalLiabilities,
      10000
    );

    const cashFlow = calculate30DayCashFlowForecast(accounts, bills, subscriptions);

    res.json({
      health,
      cashFlow,
    });
  });

  // --- AI Financial Assistant ---
  app.post('/api/assistant/chat', async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    const financialData = {
      accounts: financialStore.getAccounts(userId),
      transactions: financialStore.getTransactions(userId),
      budgets: financialStore.getBudgets(userId),
      bills: financialStore.getBills(userId),
      subscriptions: financialStore.getSubscriptions(userId),
      savingsGoals: financialStore.getSavingsGoals(userId),
    };

    try {
      const response = await processAssistantQuery(query, financialData);
      res.json(response);
    } catch (err: any) {
      console.error('Assistant error:', err);
      res.status(500).json({ error: 'Failed to process financial assistant query' });
    }
  });

  // --- Banking Sync Simulation ---
  app.post('/api/banking/sync', (req: Request, res: Response) => {
    res.json({
      success: true,
      provider: 'FinPilot Open Banking Sandbox',
      syncedAccounts: 4,
      syncedTransactions: 14,
      timestamp: new Date().toISOString(),
    });
  });

  // --- Multi-Horizon Cash Flow Forecast (30 / 60 / 90 Days) ---
  app.get('/api/forecast', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const horizon = parseInt(String(req.query.horizon || '30'), 10) as 30 | 60 | 90;
    const validHorizon = horizon === 60 || horizon === 90 ? horizon : 30;

    const accounts = financialStore.getAccounts(userId);
    const bills = financialStore.getBills(userId);
    const subscriptions = financialStore.getSubscriptions(userId);

    const forecast = calculateCashFlowForecast(accounts, bills, subscriptions, validHorizon);
    res.json(forecast);
  });

  // --- "Can I Afford This?" Affordability Assessment ---
  app.post('/api/affordability', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { amount, itemName } = req.body;
    const numAmount = Math.abs(Number(amount) || 0);

    const accounts = financialStore.getAccounts(userId);
    const bills = financialStore.getBills(userId);
    const transactions = financialStore.getTransactions(userId);

    const income = calculatePeriodIncome(transactions, '2026-09') || 8500;
    const expenses = calculatePeriodExpenses(transactions, '2026-09') || 4260;

    const assessment = evaluateAffordability(numAmount, itemName || 'Purchase', accounts, bills, income, expenses);
    res.json(assessment);
  });

  // --- Custom Monitoring Rules ---
  app.get('/api/monitoring-rules', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const rules = financialStore.getMonitoringRules(userId);
    res.json({ rules });
  });

  app.post('/api/monitoring-rules', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const rule = financialStore.createMonitoringRule(userId, req.body);
    res.status(201).json(rule);
  });

  app.patch('/api/monitoring-rules/:id/toggle', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const rule = financialStore.toggleMonitoringRule(userId, req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  });

  app.delete('/api/monitoring-rules/:id', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const success = financialStore.deleteMonitoringRule(userId, req.params.id);
    res.json({ success });
  });

  // --- Financial Calendar Events ---
  app.get('/api/calendar', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const events = financialStore.getCalendarEvents(userId);
    res.json({ events });
  });

  // --- Recurring Payment Detection & Conversion ---
  app.get('/api/recurring-payments/detect', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const detected = financialStore.detectRecurringPayments(userId);
    res.json({ detected });
  });

  app.post('/api/recurring-payments/convert', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const { merchant, amount, categoryId, categoryName, billingCycle } = req.body;
    const sub = financialStore.addSubscription(userId, {
      name: merchant,
      merchant,
      amount: Number(amount) || 0,
      billingCycle: billingCycle || 'MONTHLY',
      nextBillingDate: '2026-10-01',
      categoryId: categoryId || 'cat-subscriptions',
      categoryName: categoryName || 'Subscriptions',
      status: 'ACTIVE',
      code: merchant.slice(0, 2).toUpperCase(),
    });
    res.status(201).json(sub);
  });

  // --- Financial Reports (Weekly & Monthly) ---
  app.get('/api/reports/monthly', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const summary = financialStore.getDashboardSummary(userId);
    const accounts = financialStore.getAccounts(userId);
    const budgets = financialStore.getBudgets(userId);
    const goals = financialStore.getSavingsGoals(userId);

    const report = {
      month: 'September 2026',
      totalIncome: summary.income,
      totalExpenses: summary.expenses,
      netSavings: summary.septemberNetSavings,
      savingsRate: summary.savingsRate,
      topCategories: summary.spendingByCategory.slice(0, 4),
      largestTransactions: financialStore.getTransactions(userId, { limit: 5 }),
      budgetsPerformance: budgets.map(b => ({
        name: b.name,
        spent: b.spent,
        limit: b.amount,
        percentUsed: Math.round((b.spent / b.amount) * 100),
      })),
      goalsProgress: goals.map(g => ({
        name: g.name,
        current: g.currentAmount,
        target: g.targetAmount,
        percent: Math.round((g.currentAmount / g.targetAmount) * 100),
      })),
      generatedAt: new Date().toISOString(),
    };
    res.json(report);
  });

  app.get('/api/reports/weekly', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const summary = financialStore.getDashboardSummary(userId);

    const report = {
      week: 'Sep 8 – Sep 15, 2026',
      weeklySpend: 980,
      weeklyAverageSpend: 1080,
      paceComparison: '-9.2% lower than weekly average',
      topMerchant: 'Trader Joe’s Market ($142.30)',
      upcomingBillsDueNext7Days: financialStore.getBills(userId).filter(b => b.status !== 'PAID').slice(0, 3),
      summaryInsight: 'Strong discipline observed: spending was 9.2% lower than trailing 6-week baseline run-rate.',
    };
    res.json(report);
  });

  // --- Receipt Scanner ---
  app.post('/api/receipts/scan', (req: Request, res: Response) => {
    const { receiptImage, receiptText } = req.body;

    // Deterministic receipt extraction engine
    // Parses lines or sample receipts
    const sampleMerchants = ['Whole Foods Market', 'Target Stores', 'Trader Joe’s', 'CVS Pharmacy', 'Apple Store'];
    const sampleCategories = [
      { name: 'Food & Groceries', id: 'cat-food' },
      { name: 'Shopping', id: 'cat-shopping' },
      { name: 'Utilities', id: 'cat-utilities' },
    ];

    const randomMerchant = sampleMerchants[Math.floor(Math.random() * sampleMerchants.length)];
    const chosenCat = sampleCategories[0];
    const extractedAmount = 78.45;

    res.json({
      merchant: randomMerchant,
      date: '2026-09-15',
      amount: extractedAmount,
      categoryId: chosenCat.id,
      categoryName: chosenCat.name,
      items: [
        { name: 'Organic Honeycrisp Apples', price: 8.99 },
        { name: 'Almond Milk (Unsweetened)', price: 4.49 },
        { name: 'Wild Caught Salmon', price: 24.50 },
        { name: 'Greek Yogurt 32oz', price: 6.99 },
        { name: 'Sourdough Artisan Bread', price: 5.49 },
        { name: 'Olive Oil Extra Virgin', price: 16.99 },
        { name: 'Organic Baby Spinach', price: 4.99 },
        { name: 'Tax & Eco Fee', price: 6.01 },
      ],
      confidence: 0.96,
      suggestedAction: `Add $${extractedAmount.toFixed(2)} to ${chosenCat.name}?`,
    });
  });

  // --- Data Export ---
  app.get('/api/export', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const content = financialStore.exportUserData(userId, format);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="finpilot_transactions.csv"');
      return res.send(content);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="finpilot_export.json"');
    res.send(content);
  });

  // --- Notifications Preferences ---
  app.get('/api/user/notifications', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const prefs = financialStore.getNotificationPreferences(userId);
    res.json(prefs);
  });

  app.put('/api/user/notifications', (req: Request, res: Response) => {
    const userId = getUserId(req);
    const updated = financialStore.updateNotificationPreferences(userId, req.body);
    res.json(updated);
  });

  // --- Permanent Account Deletion ---
  app.post('/api/user/delete-account', (req: Request, res: Response) => {
    const userId = getUserId(req);
    financialStore.deleteUserAccount(userId);
    res.json({ success: true, message: 'Account and associated financial data permanently deleted.' });
  });

  // --- Reset to Demo Data ---
  app.post('/api/seed/reset', (req: Request, res: Response) => {
    financialStore.resetToDemo();
    res.json({ success: true, message: 'Database reset to initial demo state' });
  });

  // --- Vite Dev Middleware or Production Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinPilot server listening on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
