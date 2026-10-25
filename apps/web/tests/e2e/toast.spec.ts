import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
test('past-date warning is visible as a toast without moving calendar',async({page})=>{
 await page.goto('/'); await page.getByRole('button',{name:'Create an account',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(`toast-${randomUUID()}@example.com`);await page.getByLabel('Password',{exact:true}).fill('Toast-password-123');await page.getByRole('button',{name:'Create account',exact:true}).click();
 await page.getByRole('button',{name:'Month',exact:true}).click();await page.getByRole('button',{name:'Previous',exact:true}).click();
 const before=await page.locator('.calendar-card').boundingBox();
 await page.locator('.fc-day-past .fc-daygrid-day-frame').first().click({position:{x:15,y:50}});
 const toast=page.locator('.app-toast').filter({hasText:'Past days are read-only'});await expect(toast).toBeVisible();
 const box=await toast.boundingBox();expect(box!.y).toBeLessThan(50);
 const after=await page.locator('.calendar-card').boundingBox();expect(after!.y).toBe(before!.y);expect(after!.height).toBe(before!.height);
 await page.screenshot({path:'test-results/toast-warning.png'});
 await toast.getByRole('button',{name:'Dismiss notification'}).click();await expect(toast).toHaveCount(0);
});
