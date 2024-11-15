import {
  Resolver,
  Query,
  Mutation,
  Args,
  GqlExecutionContext,
} from '@nestjs/graphql';

import { Field, ID, ObjectType } from '@nestjs/graphql';
import { PrismaService } from './prisma.service';
import {
  createParamDecorator,
  ExecutionContext,
  OnModuleInit,
} from '@nestjs/common';

export const UserId = createParamDecorator((_, context: ExecutionContext) => {
  const ctx = GqlExecutionContext.create(context);
  const headers = ctx.getContext().req.headers;
  return headers['x-user-id'];
});

@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field()
  username: string;
}

@ObjectType()
export class OrderItem {
  @Field(() => ID)
  id: string;

  @Field()
  label: string;

  @Field()
  position: number;

  @Field()
  color: string;

  @Field()
  fgColor: string;
}

const STEP = 16384;

const COLORS = [
  { bg: 'rgb(246, 81, 29)', fg: 'white' },
  { bg: 'rgb(127, 184, 0)', fg: 'white' },
  { bg: 'rgb(255, 180, 0)', fg: 'black' },
  { bg: 'rgb(0, 166, 237)', fg: 'white' },
  { bg: 'rgb(13, 44, 84)', fg: 'white' },
];

const ITEMS_COUNT = COLORS.length;

const THRESHOLD = 0.1;

@Resolver(() => OrderItem)
export class OrderItemResolver implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {}

  @Query(() => User, { nullable: true })
  me(@UserId() userId: string): Promise<User> {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

  @Mutation(() => User)
  async login(@Args('username') username: string): Promise<User> {
    const user = await this.prisma.user.upsert({
      create: {
        username,
        items: {
          create: Array.from({ length: ITEMS_COUNT }, (_, i) => ({
            fgColor: COLORS[i % COLORS.length].fg,
            color: COLORS[i % COLORS.length].bg,
            position: (i + 1) * STEP,
            label: `Item ${i + 1}`,
          })),
        },
      },
      where: { username },
      update: {},
    });

    return user;
  }

  @Query(() => [OrderItem])
  async orderItems(@UserId() userId: string): Promise<OrderItem[]> {
    return this.prisma.orderItem.findMany({
      orderBy: { position: 'asc' },
      where: { userId },
    });
  }

  @Mutation(() => Boolean)
  async resetOrderItems(@UserId() userId: string): Promise<boolean> {
    await this.prisma.orderItem.deleteMany({
      where: { userId },
    });

    await this.prisma.orderItem.createMany({
      data: Array.from({ length: ITEMS_COUNT }, (_, i) => ({
        fgColor: COLORS[i % COLORS.length].fg,
        color: COLORS[i % COLORS.length].bg,
        position: (i + 1) * STEP,
        label: `Item ${i + 1}`,
        userId,
      })),
    });

    return true;
  }

  async normalizeOrderItems(
    orderItems: OrderItem[],
    userId: string,
    itemId: string,
    position: number,
  ) {
    const updatedItems = orderItems
      .map((item) => {
        if (item.id === itemId) {
          return { ...item, position };
        }
        return item;
      })
      .sort((a, b) => a.position - b.position)
      .map((item, index) => ({
        ...item,
        position: (index + 1) * STEP,
      }));

    const promises = updatedItems.map((item) =>
      this.prisma.orderItem.update({
        data: { position: item.position },
        where: { id: item.id, userId },
      }),
    );

    return this.prisma.$transaction(promises);
  }

  @Mutation(() => OrderItem)
  async updateOrderItemPosition(
    @UserId() userId: string,
    @Args('id') id: string,
    @Args('newPosition') newPosition: number,
  ): Promise<OrderItem> {
    const _orderItems = await this.prisma.orderItem.findMany({
      orderBy: { position: 'asc' },
      where: { userId },
    });

    let currentItem = _orderItems.find((item) => item.id === id);

    if (!currentItem) {
      throw new Error('Item not found');
    }

    const previousItem = _orderItems
      .filter((item) => item.id !== id)
      .reverse()
      .find((item) => item.position < newPosition);

    const nextItem = _orderItems
      .filter((item) => item.id !== id)
      .find((item) => item.position > newPosition);

    if (
      (nextItem && Math.abs(newPosition - nextItem.position) <= THRESHOLD) ||
      (previousItem &&
        Math.abs(newPosition - previousItem.position) <= THRESHOLD) ||
      newPosition <= THRESHOLD
    ) {
      const updatedItems = await this.normalizeOrderItems(
        _orderItems,
        userId,
        id,
        newPosition,
      );

      return updatedItems.find((item) => item.id === id);
    }

    const updatedItem = await this.prisma.orderItem.update({
      data: { position: newPosition },
      where: { id, userId },
    });

    return updatedItem;
  }
}
