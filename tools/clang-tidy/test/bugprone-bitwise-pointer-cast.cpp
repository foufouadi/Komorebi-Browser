using size_t = unsigned long;
void *memcpy(void *dest, const void *src, size_t n);

void foo(int **a, float **b) {
  memcpy((void**)a, (void**)b, sizeof(*a));
}
