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
}

const STEP = 16384;

const COLORS = [
  '#577590',
  '#7E8B7C',
  '#A5A068',
  '#F3CA40',
  '#F3B841',
  '#F2A541',
  '#F19846',
  '#F08A4B',
  '#E48A61',
  '#D78A76',
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
            color: COLORS[i % COLORS.length],
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
        color: COLORS[i % COLORS.length],
        position: (i + 1) * STEP,
        label: `Item ${i + 1}`,
        userId,
      })),
    });

    return true;
  }

  @Mutation(() => OrderItem)
  async updateOrderItemPosition(
    @UserId() userId: string,
    @Args('id') id: string,
    @Args('newPosition') newPosition: number,
  ): Promise<OrderItem> {
    if (newPosition <= THRESHOLD) {
      const orderItems = await this.prisma.orderItem.findMany({
        orderBy: { position: 'asc' },
        where: { userId },
      });

      const updatedItems = orderItems
        .map((item) => {
          if (item.id === id) {
            return { ...item, position: newPosition };
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

      await this.prisma.$transaction(promises);

      return updatedItems.find((item) => item.id === id);
    }

    const updatedItem = await this.prisma.orderItem.update({
      data: { position: newPosition },
      where: { id, userId },
    });

    return updatedItem;
  }
}
