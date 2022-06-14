# gpt-2-simple-sagemaker-container
A Docker container for re-training and inferencing using a GPT-2 model with SageMaker.

## Training 
The following are required to start a Training Job with this model in SageMaker. Note that this Docker image should first be imported to ECR.

### Hyper-parameters
All of these hyper parameters must be defined in the training job. The defaults listed below show the defaults of simple-gpt2.
* steps (int, default -1)
* is_multi_gpu (bool, default False)
* batch_size (int, default 1)
* learning_rate (float, default 0.0001)
* accumulate_gradients (int, default 5)
* sample_interval (int, default 100)
* sample_length (int, default 1023)
* sample_count (int, default 1)
* save_interval (int, default 1000)
* combine_input_size (int, default 50000)
* restore_from (str, default 'latest')
* run_name (str, default 'run1')
* max_checkpoints (int, default 1)
* should_use_memory_saving_gradients (bool, default False)
* should_only_train_transform_layers (bool, default False)
* optimizer (str, default 'adam')
* should_overwrite (bool, default False)

### Input
#### Model
* Channel name: model
* Channel type: S3
* Description: The model which will be fine tuned.

#### Training Data
* Channel name: text
* Channel type: S3
* Description: Files to train the model from.

## Deploying
This container will save a trained model to S3. Once training is complete a SageMaker model, endpoint, and endpoint configuration can be created for inferencing. To make this publicly accessible you'll also need a Lambda function and to setup API Gateway, like this one: https://github.com/ShepherdJerred/lambda-sagemaker-endpoint
