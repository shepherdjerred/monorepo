import gpt_2_simple as gpt2

from sagemaker import SAGEMAKER_MODEL_OUTPUT_PATH, SAGEMAKER_SAMPLE_PATH

sess = gpt2.start_tf_sess(2)

gpt2.load_gpt2(sess=sess,
               checkpoint_dir=SAGEMAKER_MODEL_OUTPUT_PATH,
               model_name=None,
               model_dir='models',
               multi_gpu=False)


def generate_response(prompt):
    print(f'generating response for prompt "{prompt}"')

    result = gpt2.generate(sess=sess,
                           run_name='run1',
                           checkpoint_dir=SAGEMAKER_MODEL_OUTPUT_PATH,
                           model_name=None,
                           sample_dir=SAGEMAKER_SAMPLE_PATH,
                           return_as_list=True,
                           truncate='<|endoftext|>',
                           destination_path=None,
                           sample_delim='=' * 20 + '\n',
                           prefix=f'<|startoftext|>\n{prompt}',
                           seed=None,
                           nsamples=1,
                           batch_size=1,
                           length=140,
                           temperature=0.7,
                           top_k=0,
                           top_p=0.0,
                           include_prefix=False)

    print(f'prompt: {prompt}\nresult: {result[0]}')
    return result[0]
